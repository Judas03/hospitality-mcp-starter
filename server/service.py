"""Reservation business logic shared by all MCP tools."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from server.models import (
    AvailabilityOccurrence,
    AvailabilityResult,
    Booking,
    BookingIdRequest,
    BookingResponse,
    BookingStatus,
    BusinessErrorCode,
    BusinessErrorResponse,
    ConfirmBookingRequest,
    CreateBookingHoldRequest,
    ErrorDetails,
    ListingDetailsResponse,
    ModifyBookingRequest,
    SearchAvailabilityRequest,
    SearchAvailabilityResponse,
)
from server.providers import PROVIDER_ADAPTERS
from server.repository import ReservationRepository


class BusinessError(Exception):
    """An expected, customer-recoverable tool failure."""

    def __init__(self, response: BusinessErrorResponse) -> None:
        super().__init__(response.error.message)
        self.response = response


class ReservationService:
    def __init__(
        self,
        repository: ReservationRepository,
        *,
        hold_ttl_seconds: int = 300,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.repository = repository
        self.hold_ttl_seconds = hold_ttl_seconds
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def search_availability(
        self, request: SearchAvailabilityRequest
    ) -> SearchAvailabilityResponse:
        adapter = PROVIDER_ADAPTERS[request.provider_type]
        results = adapter.search(self.repository, request, self.clock())
        return SearchAvailabilityResponse(results=results)

    def get_listing_details(self, listing_id: str) -> ListingDetailsResponse:
        listing = self.repository.get_listing(listing_id)
        if listing is None:
            self._raise(
                BusinessErrorCode.LISTING_NOT_FOUND,
                "The requested listing was not found.",
                retryable=False,
            )
        return ListingDetailsResponse(listing=listing)

    def create_booking_hold(self, request: CreateBookingHoldRequest) -> BookingResponse:
        now = self.clock()
        occurrence = self.repository.get_occurrence(request.availability_id)
        if occurrence is None:
            self._raise(
                BusinessErrorCode.AVAILABILITY_NOT_FOUND,
                "Search again and select one of the returned availability options.",
                retryable=True,
            )
        if request.party_size > occurrence.max_party_size:
            self._raise(
                BusinessErrorCode.SLOT_UNAVAILABLE,
                "That option cannot accommodate the requested party.",
                retryable=True,
                alternatives=self._alternatives(occurrence, request.party_size, now),
            )
        if occurrence.start_time <= now:
            self._raise(
                BusinessErrorCode.SLOT_UNAVAILABLE,
                "That option has already started.",
                retryable=True,
                alternatives=self._alternatives(occurrence, request.party_size, now),
            )
        booking = self.repository.create_booking(
            occurrence,
            guest_name=request.guest_name,
            guest_contact=request.guest_contact,
            party_size=request.party_size,
            expires_at=min(
                now + timedelta(seconds=self.hold_ttl_seconds),
                occurrence.start_time.astimezone(timezone.utc),
            ),
            now=now,
        )
        if booking is None:
            self._raise(
                BusinessErrorCode.SLOT_UNAVAILABLE,
                "That time is no longer available.",
                retryable=True,
                alternatives=self._alternatives(occurrence, request.party_size, now),
            )
        return self._booking_response(booking)

    def confirm_booking(self, request: ConfirmBookingRequest) -> BookingResponse:
        now = self.clock()
        booking = self._require_booking(request.booking_id, now)
        if not request.user_confirmed:
            self._raise(
                BusinessErrorCode.CONFIRMATION_REQUIRED,
                "Explicit user approval is required before confirmation.",
                retryable=True,
                booking=booking,
            )
        if booking.status == BookingStatus.EXPIRED:
            self._raise(
                BusinessErrorCode.HOLD_EXPIRED,
                "The booking hold has expired. Search again to create a new hold.",
                retryable=True,
                booking=booking,
            )
        if booking.status == BookingStatus.CANCELLED:
            self._raise(
                BusinessErrorCode.INVALID_STATE,
                "A cancelled booking cannot be confirmed.",
                retryable=False,
                booking=booking,
            )
        confirmed = self.repository.confirm_booking(request.booking_id, now)
        if confirmed is None:
            self._raise_booking_not_found(request.booking_id)
        if confirmed.status == BookingStatus.EXPIRED:
            self._raise(
                BusinessErrorCode.HOLD_EXPIRED,
                "The booking hold expired before it could be confirmed.",
                retryable=True,
                booking=confirmed,
            )
        return self._booking_response(confirmed)

    def modify_booking(self, request: ModifyBookingRequest) -> BookingResponse:
        now = self.clock()
        current = self._require_booking(request.booking_id, now)
        if current.status not in (BookingStatus.HELD, BookingStatus.CONFIRMED):
            self._raise(
                BusinessErrorCode.INVALID_STATE,
                f"A {current.status.value} booking cannot be modified.",
                retryable=False,
                booking=current,
            )

        occurrence: AvailabilityOccurrence | None = None
        if request.new_availability_id is not None:
            occurrence = self.repository.get_occurrence(request.new_availability_id)
            if occurrence is None:
                self._raise(
                    BusinessErrorCode.AVAILABILITY_NOT_FOUND,
                    "Search again and select one of the returned availability options.",
                    retryable=True,
                    booking=current,
                )
            if occurrence.provider_type != current.provider_type:
                self._raise(
                    BusinessErrorCode.INVALID_STATE,
                    "A booking cannot be moved to a different provider type.",
                    retryable=False,
                    booking=current,
                )
            if occurrence.start_time <= now:
                self._raise(
                    BusinessErrorCode.SLOT_UNAVAILABLE,
                    "The replacement time has already started.",
                    retryable=True,
                    booking=current,
                )
        else:
            occurrence = self.repository.get_occurrence(current.availability_id)

        target_party_size = request.party_size or current.party_size
        if occurrence is None:
            self._raise(
                BusinessErrorCode.AVAILABILITY_NOT_FOUND,
                "The booking's availability record is missing. Search for a replacement.",
                retryable=True,
                booking=current,
            )
        if target_party_size > occurrence.max_party_size:
            self._raise(
                BusinessErrorCode.SLOT_UNAVAILABLE,
                "The replacement option cannot accommodate the requested party.",
                retryable=True,
                booking=current,
                alternatives=self._alternatives(occurrence, target_party_size, now),
            )

        modified, conflict = self.repository.modify_booking(
            request.booking_id,
            occurrence if request.new_availability_id is not None else None,
            request.party_size,
            now,
        )
        if modified is None:
            self._raise_booking_not_found(request.booking_id)
        if conflict:
            self._raise(
                BusinessErrorCode.SLOT_UNAVAILABLE,
                "That replacement time is no longer available; the original booking is unchanged.",
                retryable=True,
                booking=modified,
                alternatives=self._alternatives(occurrence, target_party_size, now),
            )
        if modified.status not in (BookingStatus.HELD, BookingStatus.CONFIRMED):
            self._raise(
                BusinessErrorCode.INVALID_STATE,
                f"The booking became {modified.status.value} before it could be modified.",
                retryable=False,
                booking=modified,
            )
        return self._booking_response(modified)

    def cancel_booking(self, request: BookingIdRequest) -> BookingResponse:
        now = self.clock()
        current = self._require_booking(request.booking_id, now)
        if current.status == BookingStatus.EXPIRED:
            self._raise(
                BusinessErrorCode.INVALID_STATE,
                "An expired booking cannot be cancelled.",
                retryable=False,
                booking=current,
            )
        cancelled = self.repository.cancel_booking(request.booking_id, now)
        if cancelled is None:
            self._raise_booking_not_found(request.booking_id)
        return self._booking_response(cancelled)

    def get_booking(self, request: BookingIdRequest) -> BookingResponse:
        return self._booking_response(self._require_booking(request.booking_id, self.clock()))

    def _require_booking(self, booking_id: str, now: datetime) -> Booking:
        booking = self.repository.get_booking(booking_id, now)
        if booking is None:
            self._raise_booking_not_found(booking_id)
        return booking

    def _alternatives(
        self,
        occurrence: AvailabilityOccurrence,
        party_size: int,
        now: datetime,
    ) -> list[AvailabilityResult]:
        listing = self.repository.get_listing(occurrence.listing_id)
        if listing is None:
            return []
        request = SearchAvailabilityRequest(
            provider_type=occurrence.provider_type,
            location=listing.location,
            date=occurrence.start_time.date(),
            time=occurrence.start_time.timetz().replace(tzinfo=None),
            party_size=party_size,
            service_type=occurrence.service_type,
            room_type=occurrence.room_type,
            preferences=[],
        )
        results = PROVIDER_ADAPTERS[occurrence.provider_type].search(
            self.repository, request, now
        )
        return [
            result
            for result in results
            if result.listing_id == occurrence.listing_id
            and result.availability_id != occurrence.availability_id
        ][:2]

    def _booking_response(self, booking: Booking) -> BookingResponse:
        listing = self.repository.get_listing(booking.listing_id)
        listing_name = listing.name if listing else booking.listing_id
        time_text = booking.start_time.strftime("%I:%M %p").lstrip("0")
        if booking.status == BookingStatus.HELD and booking.expires_at is not None:
            expiry = booking.expires_at.astimezone(booking.start_time.tzinfo).strftime("%I:%M %p").lstrip("0")
            summary = (
                f"{listing_name} is held for {booking.guest_name} at {time_text} "
                f"until {expiry}."
            )
        elif booking.status == BookingStatus.CONFIRMED:
            summary = f"Booking confirmed at {listing_name} for {time_text}."
        elif booking.status == BookingStatus.CANCELLED:
            summary = f"Booking at {listing_name} has been cancelled."
        else:
            summary = f"The booking hold at {listing_name} has expired."
        return BookingResponse(booking=booking, summary=summary)

    @staticmethod
    def _raise_booking_not_found(booking_id: str) -> None:
        ReservationService._raise(
            BusinessErrorCode.BOOKING_NOT_FOUND,
            "The requested booking was not found.",
            retryable=False,
            booking_id=booking_id,
        )

    @staticmethod
    def _raise(
        code: BusinessErrorCode,
        message: str,
        *,
        retryable: bool,
        booking: Booking | None = None,
        booking_id: str | None = None,
        alternatives: list[AvailabilityResult] | None = None,
    ) -> None:
        raise BusinessError(
            BusinessErrorResponse(
                error=ErrorDetails(
                    code=code,
                    message=message,
                    retryable=retryable,
                    booking_id=booking.booking_id if booking else booking_id,
                    current_status=booking.status if booking else None,
                ),
                alternatives=alternatives or [],
            )
        )
