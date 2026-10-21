import type { Availability, Booking, BookingResult, Listing, ProviderType, SearchAvailabilityInput } from '../contract/types';

// The booking steps as one reducer: what is on screen, what is in flight, and what went wrong.
// Confirming is only possible from a live hold, never straight from a search.

export type Task = 'search' | 'hold' | 'confirm' | 'modify' | 'cancel' | 'details';
export type View = 'empty' | 'results' | 'held' | 'confirmed' | 'cancelled';

export interface Guest {
  guest_name: string;
  guest_contact: string;
}

export interface CurrentBooking {
  /** As the server last returned it. */
  booking: Booking;
  summary: string;
  /** The search result it came from, for the place's name, location and price. */
  slot: Availability;
}

export interface Conflict {
  message: string;
  /** What was being done when the option turned out to be unavailable. */
  during: 'hold' | 'confirm' | 'modify';
  alternatives: Availability[];
}

export interface FlowState {
  provider: ProviderType;
  search: SearchAvailabilityInput | null;
  assumed: Array<keyof SearchAvailabilityInput>;
  results: Availability[];
  current: CurrentBooking | null;
  view: View;
  busy: Task | null;
  conflict: Conflict | null;
  error: { message: string; during: Task } | null;
  /** Open listing details; listing is null while loading. */
  details: { listingId: string; listing: Listing | null } | null;
}

export type FlowEvent =
  | { type: 'provider_changed'; provider: ProviderType }
  | { type: 'started'; task: 'hold' | 'confirm' | 'modify' | 'cancel' }
  | { type: 'search_started'; search: SearchAvailabilityInput; assumed: Array<keyof SearchAvailabilityInput> }
  | { type: 'details_started'; listingId: string }
  | { type: 'search_succeeded'; results: Availability[] }
  | { type: 'held'; result: BookingResult; slot: Availability }
  | { type: 'confirmed'; result: BookingResult }
  | { type: 'modified'; result: BookingResult; slot: Availability }
  | { type: 'cancelled'; result: BookingResult }
  | { type: 'synced'; result: BookingResult }
  | { type: 'hold_expired' }
  | { type: 'conflict'; conflict: Conflict }
  | { type: 'failed'; message: string }
  | { type: 'details_loaded'; listingId: string; listing: Listing }
  | { type: 'details_closed' }
  | { type: 'booking_shown' }
  | { type: 'error_dismissed' }
  | { type: 'reset' };

export function initialFlow(provider: ProviderType = 'restaurant'): FlowState {
  return {
    provider,
    search: null,
    assumed: [],
    results: [],
    current: null,
    view: 'empty',
    busy: null,
    conflict: null,
    error: null,
    details: null,
  };
}

export function canConfirm(state: FlowState): boolean {
  return state.view === 'held' && state.current?.booking.status === 'held' && state.busy === null;
}

const withResult = (current: CurrentBooking, result: BookingResult, slot = current.slot): CurrentBooking => ({
  booking: result.booking,
  summary: result.summary,
  slot,
});

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'provider_changed':
      if (state.busy || event.provider === state.provider) return state;
      if (state.view === 'results' || state.view === 'empty') {
        return { ...initialFlow(event.provider), current: state.current };
      }
      return { ...state, provider: event.provider };

    case 'started':
      if (state.busy) return state;
      if (event.task === 'confirm' && !canConfirm(state)) return state;
      return { ...state, busy: event.task, error: null, details: null };

    case 'details_started':
      if (state.busy) return state;
      return { ...state, busy: 'details', error: null, details: { listingId: event.listingId, listing: null } };

    case 'search_started':
      if (state.busy) return state;
      return {
        ...state,
        provider: event.search.provider_type,
        search: event.search,
        assumed: event.assumed,
        busy: 'search',
        error: null,
        conflict: null,
        details: null,
      };

    case 'search_succeeded':
      // A confirmed booking stays reachable from the results; a hold or a cancelled booking is let go.
      return {
        ...state,
        results: event.results,
        busy: null,
        view: 'results',
        current: state.current?.booking.status === 'confirmed' ? state.current : null,
      };

    case 'held':
      return {
        ...state,
        current: { booking: event.result.booking, summary: event.result.summary, slot: event.slot },
        view: 'held',
        busy: null,
        conflict: null,
      };

    case 'confirmed':
      if (!state.current) return state;
      return { ...state, current: withResult(state.current, event.result), view: 'confirmed', busy: null };

    case 'modified':
      if (!state.current) return state;
      return { ...state, current: withResult(state.current, event.result, event.slot), busy: null, conflict: null };

    case 'cancelled': {
      if (!state.current) return state;
      // Releasing a hold goes back to the results; cancelling a confirmed booking shows it cancelled.
      if (state.view === 'held') {
        return { ...state, current: null, view: state.results.length > 0 ? 'results' : 'empty', busy: null };
      }
      return { ...state, current: withResult(state.current, event.result), view: 'cancelled', busy: null };
    }

    case 'synced':
      if (!state.current) return state;
      return { ...state, current: withResult(state.current, event.result) };

    case 'hold_expired':
      if (state.current?.booking.status !== 'held') return state;
      return {
        ...state,
        busy: null,
        current: { ...state.current, booking: { ...state.current.booking, status: 'expired', expires_at: null } },
      };

    case 'conflict': {
      const { during, alternatives } = event.conflict;
      if (during === 'modify') return { ...state, busy: null, conflict: event.conflict };
      return {
        ...state,
        busy: null,
        conflict: event.conflict,
        current: during === 'confirm' ? null : state.current,
        view: 'results',
        results: alternatives.length > 0 ? alternatives : state.results,
      };
    }

    case 'failed':
      return { ...state, busy: null, error: { message: event.message, during: state.busy ?? 'search' }, details: null };

    case 'details_loaded':
      return { ...state, busy: null, details: { listingId: event.listingId, listing: event.listing } };

    case 'details_closed':
      return { ...state, details: null };

    case 'booking_shown':
      if (state.current?.booking.status !== 'confirmed') return state;
      return { ...state, view: 'confirmed', details: null };

    case 'error_dismissed':
      return { ...state, error: null };

    case 'reset':
      return initialFlow(state.provider);
  }
}
