"""Typed request, response, and persistence models for reservations."""

from __future__ import annotations

from datetime import date, datetime, time
from enum import Enum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class ProviderType(str, Enum):
    RESTAURANT = "restaurant"
    SALON = "salon"
    HOTEL = "hotel"


class BookingStatus(str, Enum):
    HELD = "held"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"


class BusinessErrorCode(str, Enum):
    AVAILABILITY_NOT_FOUND = "availability_not_found"
    LISTING_NOT_FOUND = "listing_not_found"
    BOOKING_NOT_FOUND = "booking_not_found"
    SLOT_UNAVAILABLE = "slot_unavailable"
    HOLD_EXPIRED = "hold_expired"
    CONFIRMATION_REQUIRED = "confirmation_required"
    INVALID_STATE = "invalid_state"


NonEmptyText = Annotated[str, Field(min_length=1, max_length=200)]


class SearchAvailabilityRequest(StrictModel):
    provider_type: ProviderType
    location: NonEmptyText
    date: date
    time: time
    party_size: int = Field(default=1, ge=1, le=20)
    service_type: str | None = Field(default=None, max_length=100)
    room_type: str | None = Field(default=None, max_length=100)
    preferences: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("service_type", "room_type")
    @classmethod
    def blank_to_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("preferences")
    @classmethod
    def normalize_preferences(cls, values: list[str]) -> list[str]:
        normalized: list[str] = []
        for value in values:
            item = value.strip().lower()
            if item and item not in normalized:
                normalized.append(item)
        return normalized


class CreateBookingHoldRequest(StrictModel):
    availability_id: NonEmptyText
    guest_name: NonEmptyText
    guest_contact: NonEmptyText
    party_size: int = Field(ge=1, le=20)


class ConfirmBookingRequest(StrictModel):
    booking_id: NonEmptyText
    user_confirmed: bool


class ModifyBookingRequest(StrictModel):
    booking_id: NonEmptyText
    new_availability_id: str | None = Field(default=None, min_length=1, max_length=200)
    party_size: int | None = Field(default=None, ge=1, le=20)

    @model_validator(mode="after")
    def require_a_change(self) -> ModifyBookingRequest:
        if self.new_availability_id is None and self.party_size is None:
            raise ValueError("new_availability_id or party_size is required")
        return self


class BookingIdRequest(StrictModel):
    booking_id: NonEmptyText


class Listing(StrictModel):
    listing_id: str
    name: str
    provider_type: ProviderType
    location: str
    timezone: str
    description: str
    features: list[str]
    service_types: list[str]
    room_types: list[str]


class ListingDetailsResponse(StrictModel):
    listing: Listing


class AvailabilityTemplate(StrictModel):
    template_id: str
    listing_id: str
    local_start: time
    duration_minutes: int = Field(gt=0)
    max_party_size: int = Field(gt=0)
    service_type: str | None = None
    room_type: str | None = None
    price: float = Field(ge=0)
    currency: str = Field(min_length=3, max_length=3)


class AvailabilityOccurrence(StrictModel):
    availability_id: str
    template_id: str
    listing_id: str
    provider_type: ProviderType
    start_time: datetime
    end_time: datetime
    max_party_size: int
    service_type: str | None = None
    room_type: str | None = None
    price: float
    currency: str


class AvailabilityResult(StrictModel):
    availability_id: str
    listing_id: str
    name: str
    provider_type: ProviderType
    location: str
    start_time: datetime
    end_time: datetime
    party_size: int
    service_type: str | None = None
    room_type: str | None = None
    price: float
    currency: str
    reason: str


class SearchAvailabilityResponse(StrictModel):
    results: list[AvailabilityResult]


class Booking(StrictModel):
    booking_id: str
    availability_id: str
    listing_id: str
    provider_type: ProviderType
    status: BookingStatus
    start_time: datetime
    end_time: datetime
    guest_name: str
    guest_contact: str
    party_size: int
    service_type: str | None = None
    room_type: str | None = None
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime


class BookingResponse(StrictModel):
    booking: Booking
    summary: str


class ErrorDetails(StrictModel):
    code: BusinessErrorCode
    message: str
    retryable: bool
    booking_id: str | None = None
    current_status: BookingStatus | None = None


class BusinessErrorResponse(StrictModel):
    error: ErrorDetails
    alternatives: list[AvailabilityResult] = Field(default_factory=list)
