import { describe, expect, it } from 'vitest';
import type { Availability, Booking, BookingResult, ProviderType } from '../contract/types';
import { toolError } from '../mcp/result';
import {
  canHoldPlan,
  defaultOption,
  earliestExpiry,
  holdsBookings,
  itineraryReducer,
  RELEASED_NOTE,
  startItinerary,
  type ItineraryEvent,
} from './flow';
import { parseItinerary } from './parseItinerary';
import type { Itinerary } from './types';

// Thursday 22 October 2026, 14:00 in Bangkok.
const NOW = new Date('2026-10-22T07:00:00Z');
const EXAMPLE =
  'Plan my anniversary tomorrow in Bangkok: a manicure for me at 3 PM, a quiet dinner for two at 7 PM, and a river-view hotel for two.';

function option(provider: ProviderType, listing: string, time: string, price = 0, extra: Partial<Availability> = {}): Availability {
  return {
    availability_id: `avail_${listing}_${time.replace(':', '')}_${extra.room_type ?? extra.service_type ?? ''}`,
    listing_id: listing,
    name: listing,
    provider_type: provider,
    location: 'Bangkok',
    start_time: `2026-10-23T${time}:00+07:00`,
    end_time: `2026-10-23T${time}:00+07:00`,
    party_size: 2,
    service_type: null,
    room_type: null,
    price,
    currency: 'THB',
    reason: '',
    ...extra,
  };
}

const OPTIONS = [
  [option('salon', 'salon_002', '15:00', 650, { service_type: 'manicure' })],
  [option('restaurant', 'rest_001', '19:00'), option('restaurant', 'rest_001', '18:30')],
  [
    option('hotel', 'hotel_001', '15:00', 4200, { room_type: 'deluxe' }),
    option('hotel', 'hotel_001', '15:00', 2800, { room_type: 'standard' }),
  ],
];

function result(slot: Availability, status: Booking['status'], expiresAt: string | null = null): BookingResult {
  return {
    summary: '',
    booking: {
      booking_id: `booking_${slot.listing_id}`,
      availability_id: slot.availability_id,
      listing_id: slot.listing_id,
      provider_type: slot.provider_type,
      status,
      start_time: slot.start_time,
      end_time: slot.end_time,
      guest_name: 'Demo Guest',
      guest_contact: 'demo@example.com',
      party_size: slot.party_size,
      service_type: slot.service_type,
      room_type: slot.room_type,
      expires_at: expiresAt,
      created_at: '',
      updated_at: '',
    },
  };
}

const apply = (plan: Itinerary, ...events: ItineraryEvent[]) => events.reduce(itineraryReducer, plan);

function readyPlan(legs = 3): Itinerary {
  const parsed = parseItinerary(EXAMPLE, NOW);
  if (parsed?.kind !== 'plan') throw new Error('example is not a plan');
  const plan = startItinerary({ ...parsed, legs: parsed.legs.slice(0, legs) });
  return apply(
    plan,
    ...plan.legs.flatMap((_, index): ItineraryEvent[] => [
      { type: 'leg_search_started', index },
      { type: 'leg_searched', index, results: OPTIONS[index] },
    ]),
    { type: 'searches_done' },
  );
}

function heldPlan(): Itinerary {
  const ready = readyPlan();
  return apply(
    ready,
    { type: 'hold_started' },
    ...ready.legs.flatMap((leg, index): ItineraryEvent[] => [
      { type: 'leg_hold_started', index },
      { type: 'leg_held', index, result: result(leg.selected!, 'held', `2026-10-22T07:0${5 - index}:00Z`) },
    ]),
    { type: 'all_held' },
  );
}

describe('defaultOption', () => {
  it('takes the cheapest option at the server’s first-ranked place and start time', () => {
    expect(defaultOption(OPTIONS[2])?.room_type).toBe('standard');
  });

  it('never prefers a cheaper option at another place or time', () => {
    const first = option('salon', 'salon_002', '15:00', 650, { service_type: 'manicure' });
    const elsewhere = option('salon', 'salon_001', '14:00', 500, { service_type: 'manicure' });
    expect(defaultOption([first, elsewhere])).toBe(first);
    expect(defaultOption([])).toBeNull();
  });
});

describe('itineraryReducer: the preview', () => {
  it('selects a default per leg and is ready to hold only once every leg has one', () => {
    const plan = readyPlan();
    expect(plan.phase).toBe('ready');
    expect(plan.legs.map((leg) => leg.selected?.availability_id)).toEqual([
      OPTIONS[0][0].availability_id,
      OPTIONS[1][0].availability_id,
      OPTIONS[2][1].availability_id,
    ]);
    expect(canHoldPlan(plan)).toBe(true);

    const nothing = apply(readyPlan(), { type: 'search_retry_started', index: 0 });
    expect(nothing).toEqual(readyPlan()); // only a failed leg is searched again
    const empty = apply(startItinerary({ date: plan.date, legs: plan.legs }), { type: 'leg_search_started', index: 0 }, {
      type: 'leg_searched',
      index: 0,
      results: [],
    });
    expect(empty.legs[0]).toMatchObject({ status: 'failed', selected: null });
  });

  it('lets the guest pick another known option, but not one it never offered', () => {
    const plan = readyPlan();
    const picked = apply(plan, { type: 'option_picked', index: 2, slot: OPTIONS[2][0] });
    expect(picked.legs[2].selected?.room_type).toBe('deluxe');
    expect(apply(plan, { type: 'option_picked', index: 2, slot: option('hotel', 'hotel_009', '15:00') })).toBe(plan);
    expect(apply({ ...plan, busy: true }, { type: 'option_picked', index: 2, slot: OPTIONS[2][0] }).legs[2].selected?.room_type).toBe(
      'standard',
    );
  });

  it('keeps at least two legs', () => {
    const three = readyPlan();
    const two = apply(three, { type: 'leg_removed', index: 0 });
    expect(two.legs.map((leg) => leg.provider)).toEqual(['restaurant', 'hotel']);
    expect(apply(two, { type: 'leg_removed', index: 0 })).toBe(two);
  });
});

describe('itineraryReducer: steps happen only in their phase', () => {
  it('ignores holds, approvals and confirmations out of turn', () => {
    const searching = startItinerary({ date: '2026-10-23', legs: readyPlan().legs });
    expect(apply(searching, { type: 'hold_started' })).toBe(searching);

    const ready = readyPlan();
    expect(apply(ready, { type: 'approval_given' })).toBe(ready);
    expect(apply(ready, { type: 'cancel_started' })).toBe(ready);
    expect(apply(ready, { type: 'verified' })).toBe(ready);

    const holding = apply(ready, { type: 'hold_started' }, { type: 'leg_hold_started', index: 0 });
    expect(apply(holding, { type: 'all_held' })).toBe(holding);

    const held = heldPlan();
    expect(held.phase).toBe('awaiting_approval');
    expect(apply(held, { type: 'verified' })).toBe(held);
    expect(apply(held, { type: 'leg_confirm_started', index: 0 })).toBe(held);
  });

  it('confirms only after approval and a verification that finds every leg held', () => {
    const held = heldPlan();
    const verifying = apply(held, { type: 'approval_given' });
    expect(verifying.phase).toBe('verifying');
    const lapsed = apply(verifying, { type: 'leg_checked', index: 1, result: result(held.legs[1].selected!, 'expired') });
    expect(apply(lapsed, { type: 'verified' })).toBe(lapsed);
    const unknown = apply(verifying, { type: 'leg_check_failed', index: 0, error: toolError('No answer') });
    expect(apply(unknown, { type: 'verified' })).toBe(unknown);
    expect(apply(verifying, { type: 'verified' }).phase).toBe('confirming');
  });

  it('shows the hold that runs out first', () => {
    const held = heldPlan();
    expect(earliestExpiry(held)).toEqual({ at: Date.parse('2026-10-22T07:03:00Z'), leg: held.legs[2] });
  });
});

describe('itineraryReducer: rollback is not cancellation', () => {
  it('returns released legs to their selection after a rollback, ready to hold again', () => {
    const held = heldPlan();
    const rolled = apply(
      held,
      { type: 'rollback_started', notice: 'Something failed.' },
      { type: 'leg_release_started', index: 0 },
      { type: 'leg_released', index: 0, result: result(held.legs[0].selected!, 'cancelled') },
    );
    expect(rolled.legs[0]).toMatchObject({ status: 'selected', booking: null, note: RELEASED_NOTE });
    expect(rolled.legs[0].selected).toEqual(held.legs[0].selected);
  });

  it('keeps cancelled bookings on screen and ends the plan after Cancel whole plan', () => {
    const held = heldPlan();
    const events: ItineraryEvent[] = [{ type: 'cancel_started' }];
    held.legs.forEach((leg, index) =>
      events.push(
        { type: 'leg_release_started', index },
        { type: 'leg_released', index, result: result(leg.selected!, 'cancelled') },
      ),
    );
    const cancelled = apply(held, ...events, { type: 'release_done' });
    expect(cancelled.phase).toBe('cancelled');
    expect(cancelled.legs.map((leg) => [leg.status, leg.booking?.status])).toEqual([
      ['cancelled', 'cancelled'],
      ['cancelled', 'cancelled'],
      ['cancelled', 'cancelled'],
    ]);
    expect(holdsBookings(cancelled)).toBe(false);
    expect(apply(cancelled, { type: 'hold_started' })).toBe(cancelled);
  });

  it('stays retryable while a release is unverified, and never counts a still-held booking as released', () => {
    const held = heldPlan();
    const failed = apply(
      held,
      { type: 'cancel_started' },
      { type: 'leg_release_started', index: 2 },
      { type: 'leg_released', index: 2, result: result(held.legs[2].selected!, 'held') },
      { type: 'leg_unresolved', index: 2, error: toolError('No answer') },
      { type: 'release_done' },
    );
    expect(failed.phase).toBe('cleanup_failed');
    expect(failed.legs[2].status).toBe('unresolved');
    expect(holdsBookings(failed)).toBe(true);
    expect(apply(failed, { type: 'cleanup_retry_started' })).toMatchObject({ phase: 'cancelling', busy: true });
  });
});
