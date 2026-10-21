// Field names and shapes from docs/mcp-contract.md v0.2. This is the only place the
// frontend spells them out.

export const PROVIDER_TYPES = ['restaurant', 'salon', 'hotel'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'expired';

export interface SearchAvailabilityInput {
  provider_type: ProviderType;
  location: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, local time */
  time: string;
  party_size: number;
  service_type: string | null;
  room_type: string | null;
  preferences: string[];
}

/** One bookable option. availability_id is what holds and changes refer to. */
export interface Availability {
  availability_id: string;
  listing_id: string;
  name: string;
  provider_type: ProviderType;
  location: string;
  /** RFC 3339 with offset, e.g. 2026-10-23T19:00:00+07:00 */
  start_time: string;
  end_time: string;
  party_size: number;
  service_type: string | null;
  room_type: string | null;
  price: number;
  currency: string;
  reason: string;
}

export interface SearchAvailabilityOutput {
  results: Availability[];
}

export interface Listing {
  listing_id: string;
  name: string;
  provider_type: ProviderType;
  location: string;
  timezone: string;
  description: string;
  features: string[];
  service_types: string[];
  room_types: string[];
}

export interface ListingDetailsOutput {
  listing: Listing;
}

export interface CreateBookingHoldInput {
  availability_id: string;
  guest_name: string;
  guest_contact: string;
  party_size: number;
}

export interface Booking {
  booking_id: string;
  availability_id: string;
  listing_id: string;
  provider_type: ProviderType;
  status: BookingStatus;
  start_time: string;
  end_time: string;
  guest_name: string;
  guest_contact: string;
  party_size: number;
  service_type: string | null;
  room_type: string | null;
  /** Set while held, null otherwise. */
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingResult {
  booking: Booking;
  summary: string;
}

export interface BookingRef {
  booking_id: string;
}

export interface ConfirmBookingInput extends BookingRef {
  /** Must be exactly true, and only after the guest has said yes. */
  user_confirmed: true;
}

/** At least one of new_availability_id or party_size. */
export interface ModifyBookingInput extends BookingRef {
  new_availability_id?: string;
  party_size?: number;
}

export const BUSINESS_ERROR_CODES = [
  'availability_not_found',
  'listing_not_found',
  'booking_not_found',
  'slot_unavailable',
  'hold_expired',
  'confirmation_required',
  'invalid_state',
] as const;
export type BusinessErrorCode = (typeof BUSINESS_ERROR_CODES)[number];

/** The structured content of a tool result with isError: true. */
export interface BusinessErrorPayload {
  error: {
    code: BusinessErrorCode;
    message: string;
    retryable: boolean;
    booking_id: string | null;
    current_status: BookingStatus | null;
  };
  /** Up to two nearby options on an availability conflict, otherwise empty. */
  alternatives: Availability[];
}

export interface ToolArgs {
  search_availability: SearchAvailabilityInput;
  get_listing_details: { listing_id: string };
  create_booking_hold: CreateBookingHoldInput;
  confirm_booking: ConfirmBookingInput;
  modify_booking: ModifyBookingInput;
  cancel_booking: BookingRef;
  get_booking: BookingRef;
}

export interface ToolOutputs {
  search_availability: SearchAvailabilityOutput;
  get_listing_details: ListingDetailsOutput;
  create_booking_hold: BookingResult;
  confirm_booking: BookingResult;
  modify_booking: BookingResult;
  cancel_booking: BookingResult;
  get_booking: BookingResult;
}

export type ToolName = keyof ToolArgs;

export const DEMO_GUEST = { guest_name: 'Demo Guest', guest_contact: 'demo@example.com' } as const;
