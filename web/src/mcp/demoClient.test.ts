import { describe, expect, it } from 'vitest';
import type { Availability, BookingResult, SearchAvailabilityInput } from '../contract/types';
import { DemoClient } from './demoClient';
import { CLIENT_ERROR_CODES } from './result';
import type { LogEntry, ToolOutcome } from './types';

// Wednesday 21 October 2026, 10:00 in Bangkok.
const START = new Date('2026-10-21T03:00:00Z');

const quietDinner: SearchAvailabilityInput = {
  provider_type: 'restaurant',
  location: 'Bangkok',
  date: '2026-10-22',
  time: '19:00',
  party_size: 2,
  service_type: null,
  room_type: null,
  preferences: ['quiet'],
};
const guest = { guest_name: 'Demo Guest', guest_contact: 'demo@example.com' };
const CONTRACT_RESULT_KEYS = [
  'availability_id',
  'currency',
  'end_time',
  'listing_id',
  'location',
  'name',
  'party_size',
  'price',
  'provider_type',
  'reason',
  'room_type',
  'service_type',
  'start_time',
];

function setup() {
  let now = START;
  const log: Array<Omit<LogEntry, 'id'>> = [];
  const client = new DemoClient((entry) => log.push(entry), { now: () => now, latencyMs: 0 });
  return { client, log, advance: (seconds: number) => (now = new Date(now.getTime() + seconds * 1000)) };
}

function data<T>(out: ToolOutcome<T>): T {
  if (!out.ok) throw new Error(`${out.error.code}: ${out.error.message}`);
  return out.data;
}

async function search(client: DemoClient, input: Partial<SearchAvailabilityInput> = {}): Promise<Availability[]> {
  return data(await client.callTool('search_availability', { ...quietDinner, ...input })).results;
}

async function hold(client: DemoClient, slot: Availability, partySize = 2): Promise<BookingResult> {
  return data(await client.callTool('create_booking_hold', { availability_id: slot.availability_id, party_size: partySize, ...guest }));
}

const timeOf = (slot: { start_time: string }) => slot.start_time.slice(11, 16);

describe('DemoClient search, as the backend searches', () => {
  it('logs the MCP handshake and tool calls', async () => {
    const { client, log } = setup();
    await client.connect();
    await search(client);
    expect(log.map((entry) => entry.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    expect(log[3]).toMatchObject({ mode: 'demo', tool: 'search_availability', ok: true });
  });

  it('returns exactly the contract fields, nearest start time first', async () => {
    const { client } = setup();
    const results = await search(client);
    for (const result of results) expect(Object.keys(result).sort()).toEqual(CONTRACT_RESULT_KEYS);
    expect(results.map(timeOf)).toEqual(['19:00', '18:30', '19:30', '18:00', '20:00']);
    expect(results[0]).toMatchObject({
      availability_id: 'avail_rest_001_20261022_1900',
      name: 'Siam Serenity',
      start_time: '2026-10-22T19:00:00+07:00',
      end_time: '2026-10-22T21:00:00+07:00',
      party_size: 2,
      price: 0,
      currency: 'THB',
      reason: 'Quiet seating and a table for 2 is available at Siam Serenity',
    });
  });

  it('needs every wish to match a feature', async () => {
    const { client } = setup();
    expect(await search(client, { preferences: ['quiet', 'river view'] })).toEqual([]);
    expect((await search(client, { preferences: ['river view'] }))[0].reason).toBe(
      'River View seating and a table for 2 is available at Riverside Social',
    );
  });

  it('finds salon services and hotel rooms with their own ids and prices', async () => {
    const { client } = setup();
    const haircuts = await search(client, { provider_type: 'salon', time: '13:00', party_size: 1, service_type: 'haircut', preferences: [] });
    expect(haircuts.map((slot) => slot.availability_id)).toEqual([
      'avail_salon_001_20261022_1300_haircut',
      'avail_salon_002_20261022_1300_haircut',
      'avail_salon_001_20261022_1000_haircut',
      'avail_salon_001_20261022_1600_haircut',
    ]);
    const suites = await search(client, { provider_type: 'hotel', date: '2026-10-23', time: '15:00', party_size: 4, preferences: [] });
    expect(suites).toHaveLength(1);
    expect(suites[0]).toMatchObject({ room_type: 'suite', price: 5100, end_time: '2026-10-24T11:00:00+07:00' });
  });

  it('rejects input the server’s schema would reject, as plain text', async () => {
    const { client } = setup();
    const out = await client.callTool('search_availability', { ...quietDinner, party_size: 0 });
    expect(!out.ok && out.error.code).toBe(CLIENT_ERROR_CODES.invalidInput);
  });
});

describe('DemoClient bookings, with the backend’s rules and wording', () => {
  it('holds for five minutes and confirms only with user_confirmed true', async () => {
    const { client } = setup();
    const [best] = await search(client);
    const held = await hold(client, best);
    expect(held.booking).toMatchObject({ status: 'held', expires_at: '2026-10-21T03:05:00.000Z', party_size: 2 });
    expect(held.summary).toBe('Siam Serenity is held for Demo Guest at 7:00 PM until 10:05 AM.');

    const refused = await client.callTool('confirm_booking', { booking_id: held.booking.booking_id, user_confirmed: false as true });
    expect(!refused.ok && refused.error.code).toBe('confirmation_required');

    const confirmed = data(await client.callTool('confirm_booking', { booking_id: held.booking.booking_id, user_confirmed: true }));
    expect(confirmed.booking).toMatchObject({ status: 'confirmed', expires_at: null });
    expect(confirmed.summary).toBe('Booking confirmed at Siam Serenity for 7:00 PM.');
    const again = data(await client.callTool('confirm_booking', { booking_id: held.booking.booking_id, user_confirmed: true }));
    expect(again.booking.status).toBe('confirmed');
  });

  it('refuses a held slot and offers the two nearest times at the same place', async () => {
    const { client } = setup();
    const [best] = await search(client);
    await hold(client, best);
    const second = await client.callTool('create_booking_hold', { availability_id: best.availability_id, party_size: 2, ...guest });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error).toMatchObject({ code: 'slot_unavailable', message: 'That time is no longer available.' });
    expect(second.error.alternatives.map(timeOf)).toEqual(['18:30', '19:30']);
  });

  it('lets a hold expire', async () => {
    const { client, advance } = setup();
    const [best] = await search(client);
    const held = await hold(client, best);
    advance(301);
    const confirmed = await client.callTool('confirm_booking', { booking_id: held.booking.booking_id, user_confirmed: true });
    expect(!confirmed.ok && confirmed.error.code).toBe('hold_expired');
    const read = data(await client.callTool('get_booking', { booking_id: held.booking.booking_id }));
    expect(read.booking.status).toBe('expired');
    expect(read.summary).toBe('The booking hold at Siam Serenity has expired.');
    const cancelled = await client.callTool('cancel_booking', { booking_id: held.booking.booking_id });
    expect(!cancelled.ok && cancelled.error.code).toBe('invalid_state');
  });

  it('moves a booking to a new availability, and leaves it alone on a conflict', async () => {
    const { client } = setup();
    const results = await search(client);
    const booked = await hold(client, results[0]);
    await client.callTool('confirm_booking', { booking_id: booked.booking.booking_id, user_confirmed: true });
    const half = results.find((slot) => timeOf(slot) === '19:30')!;
    const moved = data(await client.callTool('modify_booking', { booking_id: booked.booking.booking_id, new_availability_id: half.availability_id }));
    expect(moved.booking).toMatchObject({ status: 'confirmed', availability_id: half.availability_id, start_time: half.start_time });

    const eight = results.find((slot) => timeOf(slot) === '20:00')!;
    await hold(client, eight);
    const clash = await client.callTool('modify_booking', { booking_id: booked.booking.booking_id, new_availability_id: eight.availability_id });
    expect(!clash.ok && clash.error.message).toBe(
      'That replacement time is no longer available; the original booking is unchanged.',
    );
    const after = data(await client.callTool('get_booking', { booking_id: booked.booking.booking_id }));
    expect(after.booking.start_time).toBe(half.start_time);
  });

  it('refuses a party the option cannot seat, and a change with nothing to change', async () => {
    const { client } = setup();
    const [best] = await search(client);
    const booked = await hold(client, best);
    const tooMany = await client.callTool('modify_booking', { booking_id: booked.booking.booking_id, party_size: 5 });
    expect(!tooMany.ok && tooMany.error.message).toBe('The replacement option cannot accommodate the requested party.');
    const nothing = await client.callTool('modify_booking', { booking_id: booked.booking.booking_id });
    expect(!nothing.ok && nothing.error.code).toBe('invalid_state');
    const three = data(await client.callTool('modify_booking', { booking_id: booked.booking.booking_id, party_size: 3 }));
    expect(three.booking.party_size).toBe(3);
  });

  it('cancels idempotently and will not confirm a cancelled booking', async () => {
    const { client } = setup();
    const [best] = await search(client);
    const booked = await hold(client, best);
    const cancelled = data(await client.callTool('cancel_booking', { booking_id: booked.booking.booking_id }));
    expect(cancelled.summary).toBe('Booking at Siam Serenity has been cancelled.');
    expect(data(await client.callTool('cancel_booking', { booking_id: booked.booking.booking_id })).booking.status).toBe('cancelled');
    const confirm = await client.callTool('confirm_booking', { booking_id: booked.booking.booking_id, user_confirmed: true });
    expect(!confirm.ok && confirm.error.code).toBe('invalid_state');
  });

  it('reports unknown listings, availabilities and bookings with their own codes', async () => {
    const { client } = setup();
    const listing = await client.callTool('get_listing_details', { listing_id: 'nope' });
    expect(!listing.ok && listing.error.code).toBe('listing_not_found');
    const booking = await client.callTool('get_booking', { booking_id: 'nope' });
    expect(!booking.ok && booking.error.code).toBe('booking_not_found');
    const slot = await client.callTool('create_booking_hold', { availability_id: 'avail_nope', party_size: 2, ...guest });
    expect(!slot.ok && slot.error.code).toBe('availability_not_found');
    expect(data(await client.callTool('get_listing_details', { listing_id: 'rest_001' })).listing.name).toBe('Siam Serenity');
  });
});
