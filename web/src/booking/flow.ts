import type { Booking, ListingDetails, ProviderType, SearchAvailabilityInput, SearchResult } from '../contract/types';

// The booking steps as one reducer: what is on screen, what is in flight, and what went wrong.
// Confirming is only possible from a live hold, never straight from a search.

export type Task = 'search' | 'hold' | 'confirm' | 'modify' | 'cancel' | 'details';
export type View = 'empty' | 'results' | 'held' | 'confirmed' | 'cancelled';

export interface Guest {
  guest_name: string;
  guest_contact: string;
}

export interface CurrentBooking {
  record: Booking;
  /** The chosen result, with its times updated after any change. */
  slot: SearchResult;
  partySize: number;
  guest: Guest;
}

export interface Conflict {
  message: string;
  /** What was being done when the slot turned out to be gone. */
  during: 'hold' | 'confirm' | 'modify';
  alternatives: SearchResult[];
}

export interface FlowState {
  provider: ProviderType;
  search: SearchAvailabilityInput | null;
  assumed: Array<keyof SearchAvailabilityInput>;
  results: SearchResult[];
  booking: CurrentBooking | null;
  view: View;
  busy: Task | null;
  conflict: Conflict | null;
  error: { message: string; during: Task } | null;
  /** Open listing details; data is null while loading. */
  details: { listingId: string; data: ListingDetails | null } | null;
}

export type FlowEvent =
  | { type: 'provider_changed'; provider: ProviderType }
  | { type: 'started'; task: 'hold' | 'confirm' | 'modify' | 'cancel' }
  | { type: 'search_started'; search: SearchAvailabilityInput; assumed: Array<keyof SearchAvailabilityInput> }
  | { type: 'details_started'; listingId: string }
  | { type: 'search_succeeded'; results: SearchResult[] }
  | { type: 'held'; booking: CurrentBooking }
  | { type: 'confirmed'; record: Booking }
  | { type: 'modified'; record: Booking; slot: SearchResult; partySize: number }
  | { type: 'cancelled'; record: Booking }
  | { type: 'hold_expired' }
  | { type: 'conflict'; conflict: Conflict }
  | { type: 'failed'; message: string }
  | { type: 'details_loaded'; listingId: string; data: ListingDetails }
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
    booking: null,
    view: 'empty',
    busy: null,
    conflict: null,
    error: null,
    details: null,
  };
}

export function canConfirm(state: FlowState): boolean {
  return state.view === 'held' && state.booking?.record.status === 'held' && state.busy === null;
}

export function flowReducer(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case 'provider_changed':
      if (state.busy || event.provider === state.provider) return state;
      if (state.view === 'results' || state.view === 'empty') {
        return { ...initialFlow(event.provider), booking: state.booking };
      }
      return { ...state, provider: event.provider };

    case 'started':
      if (state.busy) return state;
      if (event.task === 'confirm' && !canConfirm(state)) return state;
      return { ...state, busy: event.task, error: null, details: null };

    case 'details_started':
      if (state.busy) return state;
      return { ...state, busy: 'details', error: null, details: { listingId: event.listingId, data: null } };

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
        booking: state.booking?.record.status === 'confirmed' ? state.booking : null,
      };

    case 'held':
      return { ...state, booking: event.booking, view: 'held', busy: null, conflict: null };

    case 'confirmed':
      if (!state.booking) return state;
      return { ...state, booking: { ...state.booking, record: event.record }, view: 'confirmed', busy: null };

    case 'modified':
      if (!state.booking) return state;
      return {
        ...state,
        booking: { ...state.booking, record: event.record, slot: event.slot, partySize: event.partySize },
        busy: null,
        conflict: null,
      };

    case 'cancelled': {
      if (!state.booking) return state;
      // Releasing a hold goes back to the results; cancelling a confirmed booking shows it cancelled.
      if (state.view === 'held') {
        return { ...state, booking: null, view: state.results.length > 0 ? 'results' : 'empty', busy: null };
      }
      return { ...state, booking: { ...state.booking, record: event.record }, view: 'cancelled', busy: null };
    }

    case 'hold_expired':
      if (state.booking?.record.status !== 'held') return state;
      return { ...state, booking: { ...state.booking, record: { ...state.booking.record, status: 'expired' } } };

    case 'conflict': {
      const { during } = event.conflict;
      const lostHold = during === 'confirm';
      return {
        ...state,
        busy: null,
        conflict: event.conflict,
        booking: lostHold ? null : state.booking,
        view: during === 'modify' ? state.view : 'results',
        results: during === 'modify' ? state.results : event.conflict.alternatives,
      };
    }

    case 'failed':
      return { ...state, busy: null, error: { message: event.message, during: state.busy ?? 'search' }, details: null };

    case 'details_loaded':
      return { ...state, busy: null, details: { listingId: event.listingId, data: event.data } };

    case 'details_closed':
      return { ...state, details: null };

    case 'booking_shown':
      if (state.booking?.record.status !== 'confirmed') return state;
      return { ...state, view: 'confirmed', details: null };

    case 'error_dismissed':
      return { ...state, error: null };

    case 'reset':
      return initialFlow(state.provider);
  }
}
