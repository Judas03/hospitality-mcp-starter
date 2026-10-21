import { describe, expect, it } from 'vitest';
import type { Availability, Booking, BookingResult, SearchAvailabilityInput } from '../contract/types';
import { canConfirm, flowReducer, initialFlow, type FlowEvent, type FlowState } from './flow';

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
const slot: Availability = {
  availability_id: 'avail_rest_001_20261022_1900',
  listing_id: 'rest_001',
  name: 'Siam Serenity',
  provider_type: 'restaurant',
  location: 'Bangkok',
  start_time: '2026-10-22T19:00:00+07:00',
  end_time: '2026-10-22T21:00:00+07:00',
  party_size: 2,
  service_type: null,
  room_type: null,
  price: 0,
  currency: 'THB',
  reason: 'Quiet seating and a table for 2 is available at Siam Serenity',
};
const heldBooking: Booking = {
  booking_id: 'booking_1',
  availability_id: slot.availability_id,
  listing_id: 'rest_001',
  provider_type: 'restaurant',
  status: 'held',
  start_time: slot.start_time,
  end_time: slot.end_time,
  guest_name: 'Demo Guest',
  guest_contact: 'demo@example.com',
  party_size: 2,
  service_type: null,
  room_type: null,
  expires_at: '2026-10-21T03:05:00.000Z',
  created_at: '2026-10-21T03:00:00.000Z',
  updated_at: '2026-10-21T03:00:00.000Z',
};
const result = (status: Booking['status'], summary = status): BookingResult => ({
  booking: { ...heldBooking, status, expires_at: status === 'held' ? heldBooking.expires_at : null },
  summary,
});

const run = (...events: FlowEvent[]) => events.reduce<FlowState>(flowReducer, initialFlow());
const withResults = () => run({ type: 'search_started', search, assumed: [] }, { type: 'search_succeeded', results: [slot] });
const withHold = () =>
  flowReducer(flowReducer(withResults(), { type: 'started', task: 'hold' }), { type: 'held', result: result('held'), slot });

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
    const done = flowReducer(confirming, { type: 'confirmed', result: result('confirmed') });
    expect(done.view).toBe('confirmed');
    expect(done.current?.booking.expires_at).toBeNull();
    expect(canConfirm(done)).toBe(false);
  });

  it('cannot confirm a hold that ran out, and stops waiting', () => {
    const confirming = flowReducer(withHold(), { type: 'started', task: 'confirm' });
    const expired = flowReducer(confirming, { type: 'hold_expired' });
    expect(expired.current?.booking.status).toBe('expired');
    expect(expired.busy).toBeNull();
    expect(canConfirm(expired)).toBe(false);
  });

  it('goes back to the results when a hold is released', () => {
    const released = flowReducer(flowReducer(withHold(), { type: 'started', task: 'cancel' }), {
      type: 'cancelled',
      result: result('cancelled'),
    });
    expect(released.view).toBe('results');
    expect(released.current).toBeNull();
  });

  it('shows the server’s alternatives when a hold conflicts', () => {
    const alternative = { ...slot, availability_id: 'avail_rest_001_20261022_1930', start_time: '2026-10-22T19:30:00+07:00' };
    const state = flowReducer(flowReducer(withResults(), { type: 'started', task: 'hold' }), {
      type: 'conflict',
      conflict: { message: 'That time is no longer available.', during: 'hold', alternatives: [alternative] },
    });
    expect(state.view).toBe('results');
    expect(state.results).toEqual([alternative]);
    expect(state.busy).toBeNull();
  });

  it('keeps the booking and view when a change conflicts', () => {
    const confirmed = flowReducer(withHold(), { type: 'confirmed', result: result('confirmed') });
    const state = flowReducer(flowReducer(confirmed, { type: 'started', task: 'modify' }), {
      type: 'conflict',
      conflict: { message: 'No slot then.', during: 'modify', alternatives: [] },
    });
    expect(state.view).toBe('confirmed');
    expect(state.current?.booking.status).toBe('confirmed');
  });

  it('keeps a confirmed booking reachable after a new search', () => {
    const confirmed = flowReducer(withHold(), { type: 'confirmed', result: result('confirmed') });
    const searched = flowReducer(flowReducer(confirmed, { type: 'search_started', search, assumed: [] }), {
      type: 'search_succeeded',
      results: [],
    });
    expect(searched.view).toBe('results');
    expect(searched.current?.booking.status).toBe('confirmed');
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
