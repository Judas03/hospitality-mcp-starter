from __future__ import annotations

from datetime import date, datetime, time, timezone

import pytest

from server.models import (
    BookingIdRequest,
    BookingStatus,
    BusinessErrorCode,
    ConfirmBookingRequest,
    CreateBookingHoldRequest,
    ModifyBookingRequest,
    ProviderType,
    SearchAvailabilityRequest,
)
from server.service import BusinessError, ReservationService
from tests.conftest import MutableClock


DEMO_DATE = date(2026, 10, 23)


def restaurant_search(service: ReservationService):
    return service.search_availability(
        SearchAvailabilityRequest(
            provider_type=ProviderType.RESTAURANT,
            location="Bangkok",
            date=DEMO_DATE,
            time=time(19, 0),
            party_size=2,
            preferences=["quiet"],
        )
    )


def hold_first_restaurant(service: ReservationService):
    option = restaurant_search(service).results[0]
    return service.create_booking_hold(
        CreateBookingHoldRequest(
            availability_id=option.availability_id,
            guest_name="Demo Guest",
            guest_contact="demo@example.com",
            party_size=2,
        )
    )


def test_complete_restaurant_flow_is_explicit_and_idempotent(
    service: ReservationService,
) -> None:
    search = restaurant_search(service)
    assert search.results
    assert search.results[0].provider_type == ProviderType.RESTAURANT
    assert search.results[0].start_time.hour == 19
    assert "quiet" in search.results[0].reason.lower()

    held = hold_first_restaurant(service)
    assert held.booking.status == BookingStatus.HELD
    assert held.booking.expires_at is not None

    with pytest.raises(BusinessError) as confirmation_error:
        service.confirm_booking(
            ConfirmBookingRequest(
                booking_id=held.booking.booking_id,
                user_confirmed=False,
            )
        )
    assert confirmation_error.value.response.error.code == BusinessErrorCode.CONFIRMATION_REQUIRED
    assert service.get_booking(
        BookingIdRequest(booking_id=held.booking.booking_id)
    ).booking.status == BookingStatus.HELD

    confirmed = service.confirm_booking(
        ConfirmBookingRequest(booking_id=held.booking.booking_id, user_confirmed=True)
    )
    assert confirmed.booking.status == BookingStatus.CONFIRMED
    assert confirmed.booking.expires_at is None

    duplicate = service.confirm_booking(
        ConfirmBookingRequest(booking_id=held.booking.booking_id, user_confirmed=True)
    )
    assert duplicate.booking.status == BookingStatus.CONFIRMED

    replacement = next(
        result
        for result in restaurant_search(service).results
        if result.availability_id != held.booking.availability_id
    )
    modified = service.modify_booking(
        ModifyBookingRequest(
            booking_id=held.booking.booking_id,
            new_availability_id=replacement.availability_id,
        )
    )
    assert modified.booking.status == BookingStatus.CONFIRMED
    assert modified.booking.availability_id == replacement.availability_id

    cancelled = service.cancel_booking(BookingIdRequest(booking_id=held.booking.booking_id))
    assert cancelled.booking.status == BookingStatus.CANCELLED
    repeated_cancel = service.cancel_booking(BookingIdRequest(booking_id=held.booking.booking_id))
    assert repeated_cancel.booking.status == BookingStatus.CANCELLED


def test_conflict_returns_two_nearby_alternatives(service: ReservationService) -> None:
    option = restaurant_search(service).results[0]
    first = service.create_booking_hold(
        CreateBookingHoldRequest(
            availability_id=option.availability_id,
            guest_name="First Guest",
            guest_contact="first@example.com",
            party_size=2,
        )
    )
    assert first.booking.status == BookingStatus.HELD

    with pytest.raises(BusinessError) as conflict:
        service.create_booking_hold(
            CreateBookingHoldRequest(
                availability_id=option.availability_id,
                guest_name="Second Guest",
                guest_contact="second@example.com",
                party_size=2,
            )
        )
    payload = conflict.value.response
    assert payload.error.code == BusinessErrorCode.SLOT_UNAVAILABLE
    assert payload.error.retryable is True
    assert len(payload.alternatives) == 2
    assert all(item.availability_id != option.availability_id for item in payload.alternatives)


def test_conflicting_modification_preserves_original_booking(
    service: ReservationService,
) -> None:
    options = restaurant_search(service).results
    first = service.create_booking_hold(
        CreateBookingHoldRequest(
            availability_id=options[0].availability_id,
            guest_name="First Guest",
            guest_contact="first@example.com",
            party_size=2,
        )
    )
    service.create_booking_hold(
        CreateBookingHoldRequest(
            availability_id=options[1].availability_id,
            guest_name="Second Guest",
            guest_contact="second@example.com",
            party_size=2,
        )
    )

    with pytest.raises(BusinessError) as conflict:
        service.modify_booking(
            ModifyBookingRequest(
                booking_id=first.booking.booking_id,
                new_availability_id=options[1].availability_id,
            )
        )

    assert conflict.value.response.error.code == BusinessErrorCode.SLOT_UNAVAILABLE
    unchanged = service.get_booking(BookingIdRequest(booking_id=first.booking.booking_id))
    assert unchanged.booking.availability_id == options[0].availability_id
    assert unchanged.booking.status == BookingStatus.HELD


def test_hold_expiry_is_applied_lazily(
    service: ReservationService, clock: MutableClock
) -> None:
    held = hold_first_restaurant(service)
    clock.advance(seconds=301)

    current = service.get_booking(BookingIdRequest(booking_id=held.booking.booking_id))
    assert current.booking.status == BookingStatus.EXPIRED

    with pytest.raises(BusinessError) as expired:
        service.confirm_booking(
            ConfirmBookingRequest(booking_id=held.booking.booking_id, user_confirmed=True)
        )
    assert expired.value.response.error.code == BusinessErrorCode.HOLD_EXPIRED


def test_started_slots_are_unavailable_for_search_and_hold(
    service: ReservationService,
    clock: MutableClock,
) -> None:
    option = restaurant_search(service).results[0]
    clock.current = datetime(2026, 10, 23, 12, 0, 1, tzinfo=timezone.utc)

    refreshed = restaurant_search(service)
    assert all(result.start_time > clock.current for result in refreshed.results)

    with pytest.raises(BusinessError) as started:
        service.create_booking_hold(
            CreateBookingHoldRequest(
                availability_id=option.availability_id,
                guest_name="Late Guest",
                guest_contact="late@example.com",
                party_size=2,
            )
        )
    assert started.value.response.error.code == BusinessErrorCode.SLOT_UNAVAILABLE


def test_hold_cannot_outlive_the_slot_start(
    service: ReservationService,
    clock: MutableClock,
) -> None:
    clock.current = datetime(2026, 10, 23, 11, 58, 0, tzinfo=timezone.utc)
    option = restaurant_search(service).results[0]

    held = service.create_booking_hold(
        CreateBookingHoldRequest(
            availability_id=option.availability_id,
            guest_name="Last Minute Guest",
            guest_contact="last-minute@example.com",
            party_size=2,
        )
    )

    assert held.booking.expires_at == option.start_time
    clock.advance(seconds=121)
    current = service.get_booking(BookingIdRequest(booking_id=held.booking.booking_id))
    assert current.booking.status == BookingStatus.EXPIRED


def test_salon_and_hotel_adapters_return_provider_specific_inventory(
    service: ReservationService,
) -> None:
    salon = service.search_availability(
        SearchAvailabilityRequest(
            provider_type=ProviderType.SALON,
            location="Bangkok",
            date=DEMO_DATE,
            time=time(13, 0),
            party_size=1,
            service_type="haircut",
        )
    )
    assert salon.results
    assert all(result.service_type == "haircut" for result in salon.results)
    assert all(result.provider_type == ProviderType.SALON for result in salon.results)

    hotel = service.search_availability(
        SearchAvailabilityRequest(
            provider_type=ProviderType.HOTEL,
            location="Bangkok",
            date=DEMO_DATE,
            time=time(15, 0),
            party_size=2,
            room_type="deluxe",
        )
    )
    assert hotel.results
    assert all(result.room_type == "deluxe" for result in hotel.results)
    assert all(result.provider_type == ProviderType.HOTEL for result in hotel.results)


def test_unknown_ids_and_cross_provider_modification_return_clear_errors(
    service: ReservationService,
) -> None:
    with pytest.raises(BusinessError) as missing_listing:
        service.get_listing_details("missing")
    assert missing_listing.value.response.error.code == BusinessErrorCode.LISTING_NOT_FOUND

    with pytest.raises(BusinessError) as missing_availability:
        service.create_booking_hold(
            CreateBookingHoldRequest(
                availability_id="missing",
                guest_name="Demo Guest",
                guest_contact="demo@example.com",
                party_size=1,
            )
        )
    assert missing_availability.value.response.error.code == BusinessErrorCode.AVAILABILITY_NOT_FOUND

    held = hold_first_restaurant(service)
    salon = service.search_availability(
        SearchAvailabilityRequest(
            provider_type=ProviderType.SALON,
            location="Bangkok",
            date=DEMO_DATE,
            time=time(13, 0),
            service_type="haircut",
        )
    ).results[0]
    with pytest.raises(BusinessError) as cross_provider:
        service.modify_booking(
            ModifyBookingRequest(
                booking_id=held.booking.booking_id,
                new_availability_id=salon.availability_id,
            )
        )
    assert cross_provider.value.response.error.code == BusinessErrorCode.INVALID_STATE
