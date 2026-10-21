import { describe, expect, it } from 'vitest';
import type { Booking, SearchAvailabilityInput, SearchResult } from '../contract/types';
import { canConfirm, flowReducer, initialFlow, type CurrentBooking, type FlowEvent, type FlowState } from './flow';

const search: SearchAvailabilityInput = {
  provider_type: 'restaurant',
  location: 'Bangkok',
  date: '2026-10-22',
  time: '19:00',
  party_size: 2,
  service_type: null,
  room_type: null,
  preferences: ['quiet'],
};
const slot: SearchResult = {
  listing_id: 'rest_001',
  name: 'Baan Suan Garden Kitchen',
  provider_type: 'restaurant',
  location: 'Bangkok',
  start_time: '2026-10-22T19:00:00+07:00',
  end_time: '2026-10-22T21:00:00+07:00',
  price: 0,
  currency: 'THB',
  reason: 'Matches quiet; table for 2 free at 7:00 PM',
};
const heldRecord: Booking = { booking_id: 'bk_1001', status: 'held', expires_at: '2026-10-21T10:02:00+07:00', summary: 'On hold' };
const booking: CurrentBooking = {
  record: heldRecord,
  slot,
  partySize: 2,
  guest: { guest_name: 'Demo Guest', guest_contact: 'demo@example.com' },
};

const run = (...events: FlowEvent[]) => events.reduce<FlowState>(flowReducer, initialFlow());
const withResults = () => run({ type: 'search_started', search, assumed: [] }, { type: 'search_succeeded', results: [slot] });
const withHold = () => flowReducer(flowReducer(withResults(), { type: 'started', task: 'hold' }), { type: 'held', booking });

describe('booking steps', () => {
  it('never confirms straight from search results', () => {
    const state = withResults();
    expect(canConfirm(state)).toBe(false);
    expect(flowReducer(state, { type: 'started', task: 'confirm' })).toBe(state);
  });

  it('confirms only from a live hold', () => {
    const held = withHold();
    expect(held.view).toBe('held');
    expect(canConfirm(held)).toBe(true);
    const confirming = flowReducer(held, { type: 'started', task: 'confirm' });
    expect(confirming.busy).toBe('confirm');
    const done = flowReducer(confirming, { type: 'confirmed', record: { ...heldRecord, status: 'confirmed' } });
    expect(done.view).toBe('confirmed');
    expect(canConfirm(done)).toBe(false);
  });

  it('cannot confirm a hold that ran out', () => {
    const expired = flowReducer(withHold(), { type: 'hold_expired' });
    expect(expired.booking?.record.status).toBe('expired');
    expect(canConfirm(expired)).toBe(false);
  });

  it('goes back to the results when a hold is released', () => {
    const released = flowReducer(flowReducer(withHold(), { type: 'started', task: 'cancel' }), {
      type: 'cancelled',
      record: { ...heldRecord, status: 'cancelled' },
    });
    expect(released.view).toBe('results');
    expect(released.booking).toBeNull();
  });

  it('shows alternatives when the hold is lost at confirmation', () => {
    const alternative = { ...slot, start_time: '2026-10-22T19:30:00+07:00', end_time: '2026-10-22T21:30:00+07:00' };
    const state = flowReducer(flowReducer(withHold(), { type: 'started', task: 'confirm' }), {
      type: 'conflict',
      conflict: { message: 'Hold expired.', during: 'confirm', alternatives: [alternative] },
    });
    expect(state.view).toBe('results');
    expect(state.booking).toBeNull();
    expect(state.results).toEqual([alternative]);
    expect(state.busy).toBeNull();
  });

  it('keeps a confirmed booking reachable after a new search', () => {
    const confirmed = flowReducer(withHold(), { type: 'confirmed', record: { ...heldRecord, status: 'confirmed' } });
    const searched = flowReducer(flowReducer(confirmed, { type: 'search_started', search, assumed: [] }), {
      type: 'search_succeeded',
      results: [],
    });
    expect(searched.view).toBe('results');
    expect(searched.booking?.record.status).toBe('confirmed');
    expect(flowReducer(searched, { type: 'booking_shown' }).view).toBe('confirmed');
  });

  it('ignores a second request while one is in flight', () => {
    const busy = flowReducer(withResults(), { type: 'started', task: 'hold' });
    expect(flowReducer(busy, { type: 'search_started', search, assumed: [] })).toBe(busy);
  });

  it('records which step failed', () => {
    const failed = flowReducer(flowReducer(withResults(), { type: 'started', task: 'hold' }), {
      type: 'failed',
      message: 'Server unreachable',
    });
    expect(failed.error).toEqual({ message: 'Server unreachable', during: 'hold' });
    expect(failed.busy).toBeNull();
  });
});
