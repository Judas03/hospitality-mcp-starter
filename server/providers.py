"""Provider-specific availability filtering behind one shared interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from server.models import (
    AvailabilityOccurrence,
    AvailabilityResult,
    AvailabilityTemplate,
    Listing,
    ProviderType,
    SearchAvailabilityRequest,
)
from server.repository import ReservationRepository


class ProviderAdapter(ABC):
    provider_type: ProviderType
    max_search_distance_minutes = 180

    def search(
        self,
        repository: ReservationRepository,
        request: SearchAvailabilityRequest,
        now: datetime,
    ) -> list[AvailabilityResult]:
        matches: list[tuple[int, AvailabilityResult]] = []
        for listing, template in repository.list_candidates(self.provider_type, request.location):
            if not self.matches(listing, template, request):
                continue
            requested_minutes = request.time.hour * 60 + request.time.minute
            template_minutes = template.local_start.hour * 60 + template.local_start.minute
            distance = abs(template_minutes - requested_minutes)
            if distance > self.max_search_distance_minutes:
                continue

            start = datetime.combine(
                request.date,
                template.local_start,
                tzinfo=ZoneInfo(listing.timezone),
            )
            end = start + timedelta(minutes=template.duration_minutes)
            if start <= now:
                continue
            occurrence = AvailabilityOccurrence(
                availability_id=repository.make_availability_id(listing, template, request.date),
                template_id=template.template_id,
                listing_id=listing.listing_id,
                provider_type=listing.provider_type,
                start_time=start,
                end_time=end,
                max_party_size=template.max_party_size,
                service_type=template.service_type,
                room_type=template.room_type,
                price=template.price,
                currency=template.currency,
            )
            repository.upsert_occurrence(occurrence)
            if not repository.is_available(occurrence.availability_id, now):
                continue
            matches.append(
                (
                    distance,
                    AvailabilityResult(
                        availability_id=occurrence.availability_id,
                        listing_id=listing.listing_id,
                        name=listing.name,
                        provider_type=listing.provider_type,
                        location=listing.location,
                        start_time=start,
                        end_time=end,
                        party_size=request.party_size,
                        service_type=template.service_type,
                        room_type=template.room_type,
                        price=template.price,
                        currency=template.currency,
                        reason=self.reason(listing, template, request),
                    ),
                )
            )
        matches.sort(key=lambda item: (item[0], item[1].start_time, item[1].listing_id))
        return [result for _, result in matches[:10]]

    @abstractmethod
    def matches(
        self,
        listing: Listing,
        template: AvailabilityTemplate,
        request: SearchAvailabilityRequest,
    ) -> bool:
        raise NotImplementedError

    @abstractmethod
    def reason(
        self,
        listing: Listing,
        template: AvailabilityTemplate,
        request: SearchAvailabilityRequest,
    ) -> str:
        raise NotImplementedError

    @staticmethod
    def preferences_match(listing: Listing, preferences: list[str]) -> bool:
        features = {feature.lower() for feature in listing.features}
        return all(preference.lower() in features for preference in preferences)


class RestaurantAdapter(ProviderAdapter):
    provider_type = ProviderType.RESTAURANT

    def matches(
        self,
        listing: Listing,
        template: AvailabilityTemplate,
        request: SearchAvailabilityRequest,
    ) -> bool:
        return request.party_size <= template.max_party_size and self.preferences_match(
            listing, request.preferences
        )

    def reason(
        self,
        listing: Listing,
        template: AvailabilityTemplate,
        request: SearchAvailabilityRequest,
    ) -> str:
        preference = f"{', '.join(request.preferences).title()} seating and " if request.preferences else ""
        return f"{preference}a table for {request.party_size} is available at {listing.name}"


class SalonAdapter(ProviderAdapter):
    provider_type = ProviderType.SALON

    def matches(
        self,
        listing: Listing,
        template: AvailabilityTemplate,
        request: SearchAvailabilityRequest,
    ) -> bool:
        if request.party_size > template.max_party_size:
            return False
        if request.service_type and request.service_type.lower() != (template.service_type or "").lower():
            return False
        return self.preferences_match(listing, request.preferences)

    def reason(
        self,
        listing: Listing,
        template: AvailabilityTemplate,
        request: SearchAvailabilityRequest,
    ) -> str:
        return f"A {template.service_type} appointment is available at {listing.name}"


class HotelAdapter(ProviderAdapter):
    provider_type = ProviderType.HOTEL

    def matches(
        self,
        listing: Listing,
        template: AvailabilityTemplate,
        request: SearchAvailabilityRequest,
    ) -> bool:
        if request.party_size > template.max_party_size:
            return False
        if request.room_type and request.room_type.lower() != (template.room_type or "").lower():
            return False
        return self.preferences_match(listing, request.preferences)

    def reason(
        self,
        listing: Listing,
        template: AvailabilityTemplate,
        request: SearchAvailabilityRequest,
    ) -> str:
        return f"A {template.room_type} room for {request.party_size} is available at {listing.name}"


PROVIDER_ADAPTERS: dict[ProviderType, ProviderAdapter] = {
    ProviderType.RESTAURANT: RestaurantAdapter(),
    ProviderType.SALON: SalonAdapter(),
    ProviderType.HOTEL: HotelAdapter(),
}
