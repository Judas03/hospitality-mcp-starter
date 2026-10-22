import type { Availability, BookingResult, BookingStatus } from '../contract/types';
import type { ToolError } from '../mcp/types';
import type { Itinerary, Leg, LegStatus, PlannedLeg } from './types';

// The plan's steps as one pure reducer. Every event is checked against the phase it may happen
// in and ignored otherwise, so holds only start from a ready plan, confirm_booking only follows a
// verified approval, and a rollback can never be mistaken for the guest's own cancellation.

export type ItineraryEvent =
  | { type: 'leg_search_started'; index: number }
  | { type: 'leg_searched'; index: number; results: Availability[] }
  | { type: 'leg_search_failed'; index: number; error: ToolError }
  | { type: 'search_retry_started'; index: number }
  | { type: 'searches_done' }
  | { type: 'option_picked'; index: number; slot: Availability }
  | { type: 'leg_removed'; index: number }
  | { type: 'hold_started' }
  | { type: 'leg_hold_started'; index: number }
  | { type: 'leg_held'; index: number; result: BookingResult }
  /** `mayBeHeld` when the server never answered; `at` is when, in epoch milliseconds. */
  | { type: 'leg_hold_failed'; index: number; error: ToolError; mayBeHeld: boolean; at: number }
  | { type: 'all_held' }
  | { type: 'approval_given' }
  /** The earliest hold's time is up: check every hold with the server. */
  | { type: 'check_started' }
  | { type: 'leg_checked'; index: number; result: BookingResult }
  | { type: 'leg_check_failed'; index: number; error: ToolError }
  | { type: 'check_done' }
  | { type: 'verified' }
  | { type: 'leg_confirm_started'; index: number }
  | { type: 'leg_confirmed'; index: number; result: BookingResult }
  | { type: 'leg_confirm_failed'; index: number; error: ToolError }
  | { type: 'all_confirmed' }
  /** Something failed: release what the plan holds and go back to the preview. */
  | { type: 'rollback_started'; notice: string }
  /** The guest's Cancel whole plan: release everything and end the plan. */
  | { type: 'cancel_started' }
  | { type: 'cleanup_retry_started' }
  | { type: 'leg_release_started'; index: number }
  | { type: 'leg_released'; index: number; result: BookingResult }
  | { type: 'leg_unresolved'; index: number; error: ToolError }
  | { type: 'release_done' }
  /** Look for holds that got no answer: by the time passed, or by a fresh search. */
  | { type: 'unknown_check_started' }
  | { type: 'unknown_hold_cleared'; index: number; note: string }
  | { type: 'unknown_check_done' };

/** Legs that may hold a booking on the server, so a rollback or cancellation must release them. */
const RELEASABLE: LegStatus[] = ['held', 'confirmed', 'unresolved'];
/** Legs whose booking is active or not yet verified as released. */
const ACTIVE: LegStatus[] = ['holding', 'held', 'confirming', 'confirmed', 'cancelling', 'unresolved'];

export const RELEASED_NOTE = 'Released';
export const RAN_OUT_NOTE = 'Hold ran out';
export const NOTHING_FOUND_NOTE = 'Nothing matches this part.';

/**
 * How long a hold that got no answer may exist: the contract's hold length. Holds never outlast
 * it, so after this a hold the page never heard about has run out on the server.
 */
export const UNKNOWN_HOLD_MS = 5 * 60_000;

export function startItinerary(plan: { date: string; legs: PlannedLeg[] }): Itinerary {
  return {
    date: plan.date,
    phase: 'searching',
    busy: true,
    notice: null,
    legs: plan.legs.map(({ search, assumed }) => ({
      provider: search.provider_type,
      search,
      assumed,
      status: 'idle',
      options: [],
      selected: null,
      booking: null,
      error: null,
      alternatives: [],
      note: null,
      mayBeHeld: null,
    })),
  };
}

/**
 * The option a leg holds unless the guest picks another: the cheapest at the server's
 * first-ranked place and start time. A cheaper option at another place or time never wins.
 */
export function defaultOption(results: Availability[]): Availability | null {
  const [first] = results;
  if (!first) return null;
  return results
    .filter((option) => option.listing_id === first.listing_id && option.start_time === first.start_time)
    .reduce((best, option) => (option.price < best.price ? option : best));
}

/** A hold got no answer and may still exist on the server. */
export function hasUnknownHold(plan: Itinerary): boolean {
  return plan.legs.some((leg) => leg.mayBeHeld !== null);
}

/** When the last hold that got no answer has certainly run out, or null when there is none. */
export function unknownHoldsUntil(plan: Itinerary): number | null {
  const times = plan.legs.flatMap((leg) => (leg.mayBeHeld ? [leg.mayBeHeld.until] : []));
  return times.length > 0 ? Math.max(...times) : null;
}

export function canHoldPlan(plan: Itinerary): boolean {
  return (
    plan.phase === 'ready' &&
    !plan.busy &&
    !hasUnknownHold(plan) &&
    plan.legs.every((leg) => leg.status === 'selected' && leg.selected !== null)
  );
}

export function canConfirmPlan(plan: Itinerary): boolean {
  return plan.phase === 'awaiting_approval' && !plan.busy;
}

export function canCancelPlan(plan: Itinerary): boolean {
  return (plan.phase === 'awaiting_approval' || plan.phase === 'confirmed') && !plan.busy;
}

/**
 * Legs may be removed from the preview, but a plan always keeps at least two, and a leg whose hold
 * got no answer stays until that is cleared.
 */
export function canRemoveLeg(plan: Itinerary, index?: number): boolean {
  const leg = index === undefined ? null : plan.legs[index];
  return plan.phase === 'ready' && !plan.busy && plan.legs.length > 2 && leg?.mayBeHeld == null;
}

/**
 * Whether any leg's booking is active or unverified, including a hold that got no answer, so the
 * plan can't be closed or replaced and nothing else can start.
 */
export function holdsBookings(plan: Itinerary): boolean {
  return plan.legs.some((leg) => ACTIVE.includes(leg.status) || leg.mayBeHeld !== null);
}

export function releasableLegs(plan: Itinerary): number[] {
  return plan.legs.flatMap((leg, index) => (leg.booking && RELEASABLE.includes(leg.status) ? [index] : []));
}

export function unresolvedLegs(plan: Itinerary): Leg[] {
  return plan.legs.filter((leg) => leg.status === 'unresolved');
}

/** The hold that runs out first, while the plan holds anything. */
export function earliestExpiry(plan: Itinerary): { at: number; leg: Leg } | null {
  let earliest: { at: number; leg: Leg } | null = null;
  for (const leg of plan.legs) {
    if (leg.status !== 'held' || !leg.booking?.expires_at) continue;
    const at = Date.parse(leg.booking.expires_at);
    if (!earliest || at < earliest.at) earliest = { at, leg };
  }
  return earliest;
}

const STATUS_FOR: Record<BookingStatus, LegStatus> = {
  held: 'held',
  confirmed: 'confirmed',
  cancelled: 'cancelled',
  expired: 'expired',
};

function updateLeg(plan: Itinerary, index: number, from: LegStatus[], change: (leg: Leg) => Partial<Leg>): Itinerary {
  const leg = plan.legs[index];
  if (!leg || !from.includes(leg.status)) return plan;
  const legs = plan.legs.slice();
  legs[index] = { ...leg, ...change(leg) };
  return { ...plan, legs };
}

const inPhase = (plan: Itinerary, ...phases: Itinerary['phase'][]) => phases.includes(plan.phase);

export function itineraryReducer(plan: Itinerary, event: ItineraryEvent): Itinerary {
  switch (event.type) {
    case 'leg_search_started':
      if (!inPhase(plan, 'searching')) return plan;
      return updateLeg(plan, event.index, ['idle', 'searching'], () => ({ status: 'searching', error: null, note: null }));

    case 'leg_searched':
      return updateLeg(plan, event.index, ['searching'], () => {
        const selected = defaultOption(event.results);
        return selected
          ? { status: 'selected', options: event.results, selected, alternatives: [] }
          : { status: 'failed', options: [], selected: null, alternatives: [], note: NOTHING_FOUND_NOTE };
      });

    case 'leg_search_failed':
      return updateLeg(plan, event.index, ['searching'], () => ({ status: 'failed', options: [], selected: null, error: event.error }));

    case 'search_retry_started':
      if (!inPhase(plan, 'ready') || plan.busy || plan.legs[event.index]?.status !== 'failed') return plan;
      return {
        ...updateLeg(plan, event.index, ['failed'], () => ({ status: 'searching', error: null, note: null, alternatives: [] })),
        phase: 'searching',
        busy: true,
        notice: null,
      };

    case 'searches_done':
      if (!inPhase(plan, 'searching')) return plan;
      return { ...plan, phase: 'ready', busy: false };

    case 'option_picked': {
      if (!inPhase(plan, 'ready') || plan.busy) return plan;
      const leg = plan.legs[event.index];
      const known = [...(leg?.options ?? []), ...(leg?.alternatives ?? [])];
      if (!known.some((option) => option.availability_id === event.slot.availability_id)) return plan;
      return updateLeg(plan, event.index, ['selected', 'failed'], (current) => ({
        status: 'selected',
        selected: event.slot,
        // An alternative the guest picks becomes one of the leg's options.
        options: current.options.some((option) => option.availability_id === event.slot.availability_id)
          ? current.options
          : [...current.options, event.slot],
        alternatives: [],
        error: null,
        note: null,
      }));
    }

    case 'leg_removed':
      if (!plan.legs[event.index] || !canRemoveLeg(plan, event.index)) return plan;
      return { ...plan, legs: plan.legs.filter((_, index) => index !== event.index) };

    case 'hold_started':
      if (!canHoldPlan(plan)) return plan;
      return {
        ...plan,
        phase: 'holding',
        busy: true,
        notice: null,
        legs: plan.legs.map((leg) => ({ ...leg, note: null })),
      };

    case 'leg_hold_started':
      if (!inPhase(plan, 'holding')) return plan;
      return updateLeg(plan, event.index, ['selected'], () => ({ status: 'holding' }));

    case 'leg_held':
      return updateLeg(plan, event.index, ['holding'], () => ({
        status: 'held',
        booking: event.result.booking,
        error: null,
      }));

    case 'leg_hold_failed':
      return updateLeg(plan, event.index, ['holding'], (leg) => ({
        status: 'failed',
        error: event.error,
        alternatives: event.error.alternatives,
        mayBeHeld:
          event.mayBeHeld && leg.selected
            ? { availabilityId: leg.selected.availability_id, name: leg.selected.name, until: event.at + UNKNOWN_HOLD_MS }
            : leg.mayBeHeld,
      }));

    case 'all_held':
      if (!inPhase(plan, 'holding') || !plan.legs.every((leg) => leg.status === 'held')) return plan;
      return { ...plan, phase: 'awaiting_approval', busy: false };

    case 'approval_given':
      if (!canConfirmPlan(plan)) return plan;
      return { ...plan, phase: 'verifying', busy: true };

    case 'check_started':
      if (!canConfirmPlan(plan)) return plan;
      return { ...plan, busy: true };

    case 'leg_checked':
      if (!inPhase(plan, 'verifying', 'awaiting_approval')) return plan;
      return updateLeg(plan, event.index, ['held'], () => ({
        status: STATUS_FOR[event.result.booking.status],
        booking: event.result.booking,
      }));

    case 'leg_check_failed':
      if (!inPhase(plan, 'verifying', 'awaiting_approval')) return plan;
      return updateLeg(plan, event.index, ['held'], () => ({ error: event.error }));

    case 'check_done':
      if (!inPhase(plan, 'awaiting_approval')) return plan;
      return { ...plan, busy: false };

    case 'verified':
      if (!inPhase(plan, 'verifying') || !plan.legs.every((leg) => leg.status === 'held' && !leg.error)) return plan;
      return { ...plan, phase: 'confirming' };

    case 'leg_confirm_started':
      if (!inPhase(plan, 'confirming')) return plan;
      return updateLeg(plan, event.index, ['held'], () => ({ status: 'confirming' }));

    case 'leg_confirmed':
      return updateLeg(plan, event.index, ['confirming'], () => ({ status: 'confirmed', booking: event.result.booking }));

    case 'leg_confirm_failed':
      return updateLeg(plan, event.index, ['confirming'], (leg) =>
        event.error.code === 'hold_expired' && leg.booking
          ? { status: 'expired', booking: { ...leg.booking, status: 'expired', expires_at: null }, error: event.error }
          : // The last status the server confirmed; the rollback releases it either way.
            { status: 'held', error: event.error },
      );

    case 'all_confirmed':
      if (!inPhase(plan, 'confirming') || !plan.legs.every((leg) => leg.status === 'confirmed')) return plan;
      return { ...plan, phase: 'confirmed', busy: false };

    case 'rollback_started':
      if (!inPhase(plan, 'holding', 'verifying', 'confirming', 'awaiting_approval')) return plan;
      return { ...plan, phase: 'rolling_back', busy: true, notice: event.notice };

    case 'cancel_started':
      if (!canCancelPlan(plan)) return plan;
      return { ...plan, phase: 'cancelling', busy: true, notice: null };

    case 'cleanup_retry_started':
      if (!inPhase(plan, 'cleanup_failed') || plan.busy) return plan;
      return { ...plan, phase: 'cancelling', busy: true };

    case 'leg_release_started':
      if (!inPhase(plan, 'rolling_back', 'cancelling')) return plan;
      return updateLeg(plan, event.index, RELEASABLE, () => ({ status: 'cancelling' }));

    case 'leg_released': {
      const status = event.result.booking.status;
      if (status !== 'cancelled' && status !== 'expired') return plan;
      // A rollback clears the booking and keeps the choice, so the plan can be held again;
      // the guest's own cancellation keeps the cancelled booking on screen.
      if (inPhase(plan, 'rolling_back')) {
        return updateLeg(plan, event.index, ['cancelling'], () => ({
          status: 'selected',
          booking: null,
          error: null,
          note: status === 'expired' ? RAN_OUT_NOTE : RELEASED_NOTE,
        }));
      }
      if (!inPhase(plan, 'cancelling')) return plan;
      return updateLeg(plan, event.index, ['cancelling'], () => ({
        status: STATUS_FOR[status],
        booking: event.result.booking,
        error: null,
      }));
    }

    case 'leg_unresolved':
      if (!inPhase(plan, 'rolling_back', 'cancelling')) return plan;
      return updateLeg(plan, event.index, ['cancelling'], () => ({ status: 'unresolved', error: event.error }));

    case 'release_done': {
      if (!inPhase(plan, 'rolling_back', 'cancelling')) return plan;
      if (plan.legs.some((leg) => leg.status === 'unresolved')) return { ...plan, phase: 'cleanup_failed', busy: false };
      if (inPhase(plan, 'cancelling')) return { ...plan, phase: 'cancelled', busy: false };
      // Back to the preview: a hold that ran out is released already and can be held again.
      const legs = plan.legs.map((leg): Leg =>
        leg.status === 'expired' ? { ...leg, status: 'selected', booking: null, error: null, note: RAN_OUT_NOTE } : leg,
      );
      return { ...plan, legs, phase: 'ready', busy: false };
    }

    case 'unknown_check_started':
      if (plan.busy || !hasUnknownHold(plan)) return plan;
      return { ...plan, busy: true };

    case 'unknown_hold_cleared': {
      const leg = plan.legs[event.index];
      if (!plan.busy || !leg?.mayBeHeld) return plan;
      const legs = plan.legs.slice();
      legs[event.index] = { ...leg, mayBeHeld: null, note: event.note };
      return { ...plan, legs };
    }

    case 'unknown_check_done':
      return plan.busy ? { ...plan, busy: false } : plan;
  }
}
