// Field names and shapes from docs/mcp-contract.md (v0.1). This is the only place the
// frontend spells them out. Anything the contract does not write down yet is marked
// ASSUMED and reuses the contract's own field names; see the open questions to the backend.

export const PROVIDER_TYPES = ['restaurant', 'salon', 'hotel'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export interface SearchAvailabilityInput {
  provider_type: ProviderType;
  location: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, 24-hour */
  time: string;
  party_size: number;
  service_type: string | null;
  room_type: string | null;
  preferences: string[];
}

export interface SearchResult {
  listing_id: string;
  name: string;
  provider_type: ProviderType;
  location: string;
  /** ISO 8601 with offset, e.g. 2026-10-23T19:00:00+07:00 */
  start_time: string;
  end_time: string;
  price: number;
  currency: string;
  reason: string;
}

export interface SearchAvailabilityOutput {
  results: SearchResult[];
}

export interface GetListingDetailsInput {
  listing_id: string;
}

/** The contract does not list these fields yet, so the page shows whatever comes back. */
export type ListingDetails = Record<string, unknown>;

export interface CreateBookingHoldInput {
  listing_id: string;
  start_time: string;
  end_time: string;
  guest_name: string;
  guest_contact: string;
  party_size: number;
}

/** Only "held" is named in the contract; the others are ASSUMED. */
export type BookingStatus = 'held' | 'confirmed' | 'cancelled' | 'expired' | (string & {});

export interface Booking {
  booking_id: string;
  status: BookingStatus;
  /** Present on holds. */
  expires_at?: string;
  summary: string;
}

/** ASSUMED: confirm, cancel and get take the booking_id that create_booking_hold returned. */
export interface BookingRef {
  booking_id: string;
}

/** ASSUMED: modify accepts the hold's own time and party fields. */
export interface ModifyBookingInput extends BookingRef {
  start_time?: string;
  end_time?: string;
  party_size?: number;
}

export interface ToolArgs {
  search_availability: SearchAvailabilityInput;
  get_listing_details: GetListingDetailsInput;
  create_booking_hold: CreateBookingHoldInput;
  confirm_booking: BookingRef;
  modify_booking: ModifyBookingInput;
  cancel_booking: BookingRef;
  get_booking: BookingRef;
}

export interface ToolOutputs {
  search_availability: SearchAvailabilityOutput;
  get_listing_details: ListingDetails;
  create_booking_hold: Booking;
  confirm_booking: Booking;
  modify_booking: Booking;
  cancel_booking: Booking;
  get_booking: Booking;
}

export type ToolName = keyof ToolArgs;

export const DEMO_GUEST = { guest_name: 'Demo Guest', guest_contact: 'demo@example.com' } as const;
