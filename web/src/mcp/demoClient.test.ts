import { describe, expect, it } from 'vitest';
import type { SearchAvailabilityInput, SearchResult } from '../contract/types';
import { DemoClient } from './demoClient';
import { ERROR_CODES } from './result';
import type { LogEntry } from './types';

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
  'currency',
  'end_time',
  'listing_id',
  'location',
  'name',
  'price',
  'provider_type',
  'reason',
  'start_time',
];

function setup() {
  let now = new Date('2026-10-21T03:00:00Z');
  const log: Array<Omit<LogEntry, 'id'>> = [];
  const client = new DemoClient((entry) => log.push(entry), { now: () => now, latencyMs: 0, holdSeconds: 120 });
  return { client, log, advance: (seconds: number) => (now = new Date(now.getTime() + seconds * 1000)) };
}

async function search(client: DemoClient, input = quietDinner): Promise<SearchResult[]> {
  const out = await client.callTool('search_availability', input);
  if (!out.ok) throw new Error(out.error.message);
  return out.data.results;
}

const holdArgs = (slot: SearchResult) => ({
  listing_id: slot.listing_id,
  start_time: slot.start_time,
  end_time: slot.end_time,
  party_size: 2,
  ...guest,
});

describe('DemoClient', () => {
  it('logs the MCP handshake and tool calls', async () => {
    const { client, log } = setup();
    await client.connect();
    await search(client);
    expect(log.map((entry) => entry.method)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    expect(log[3]).toMatchObject({ mode: 'demo', tool: 'search_availability', ok: true });
  });

  it('returns results with exactly the contract fields, best match first', async () => {
    const { client } = setup();
    const results = await search(client);
    expect(results.length).toBeGreaterThan(0);
    for (const result of results) expect(Object.keys(result).sort()).toEqual(CONTRACT_RESULT_KEYS);
    expect(results[0]).toMatchObject({
      start_time: '2026-10-22T19:00:00+07:00',
      end_time: '2026-10-22T21:00:00+07:00',
      currency: 'THB',
    });
    expect(results[0].reason).toMatch(/quiet/);
  });

  it('holds, then confirms only on request', async () => {
    const { client } = setup();
    const [best] = await search(client);
    const held = await client.callTool('create_booking_hold', holdArgs(best));
    expect(held.ok && held.data.status).toBe('held');
    if (!held.ok) return;
    expect(held.data.expires_at).toBe('2026-10-21T10:02:00+07:00');
    const confirmed = await client.callTool('confirm_booking', { booking_id: held.data.booking_id });
    expect(confirmed.ok && confirmed.data.status).toBe('confirmed');
    const again = await client.callTool('confirm_booking', { booking_id: held.data.booking_id });
    expect(again.ok && again.data.summary).toMatch(/^Already confirmed/);
  });

  it('refuses a slot that is already held', async () => {
    const { client } = setup();
    const [best] = await search(client);
    await client.callTool('create_booking_hold', holdArgs(best));
    const second = await client.callTool('create_booking_hold', holdArgs(best));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe(ERROR_CODES.slotUnavailable);
  });

  it('lets a hold run out', async () => {
    const { client, advance } = setup();
    const [best] = await search(client);
    const held = await client.callTool('create_booking_hold', holdArgs(best));
    if (!held.ok) throw new Error('hold failed');
    advance(121);
    const confirmed = await client.callTool('confirm_booking', { booking_id: held.data.booking_id });
    expect(confirmed.ok).toBe(false);
    if (!confirmed.ok) expect(confirmed.error.code).toBe(ERROR_CODES.holdExpired);
  });

  it('offers the closest free time once a slot is booked, and says why', async () => {
    const { client } = setup();
    const [best] = await search(client);
    const held = await client.callTool('create_booking_hold', holdArgs(best));
    if (!held.ok) throw new Error('hold failed');
    await client.callTool('confirm_booking', { booking_id: held.data.booking_id });
    const again = (await search(client)).find((result) => result.listing_id === best.listing_id);
    expect(again?.start_time).toBe('2026-10-22T19:30:00+07:00');
    expect(again?.reason).toMatch(/7:00 PM is taken/);
  });

  it('refuses a hold outside opening hours', async () => {
    const { client } = setup();
    const [best] = await search(client);
    const late = await client.callTool('create_booking_hold', {
      ...holdArgs(best),
      start_time: '2026-10-22T22:00:00+07:00',
      end_time: '2026-10-23T00:00:00+07:00',
    });
    expect(!late.ok && late.error.code).toBe(ERROR_CODES.slotUnavailable);
  });

  it('changes and cancels a booking, and refuses a taken time', async () => {
    const { client } = setup();
    const results = await search(client);
    const first = await client.callTool('create_booking_hold', holdArgs(results[0]));
    if (!first.ok) throw new Error('hold failed');
    const lunch = await client.callTool('create_booking_hold', {
      ...holdArgs(results[0]),
      start_time: '2026-10-22T12:00:00+07:00',
      end_time: '2026-10-22T14:00:00+07:00',
    });
    expect(lunch.ok).toBe(true);
    const clash = await client.callTool('modify_booking', {
      booking_id: first.data.booking_id,
      start_time: '2026-10-22T12:00:00+07:00',
      end_time: '2026-10-22T14:00:00+07:00',
    });
    expect(!clash.ok && clash.error.code).toBe(ERROR_CODES.slotUnavailable);
    const moved = await client.callTool('modify_booking', {
      booking_id: first.data.booking_id,
      start_time: '2026-10-22T20:00:00+07:00',
      end_time: '2026-10-22T22:00:00+07:00',
      party_size: 3,
    });
    expect(moved.ok && moved.data.summary).toMatch(/^Changed: table for 3/);
    const cancelled = await client.callTool('cancel_booking', { booking_id: first.data.booking_id });
    expect(cancelled.ok && cancelled.data.status).toBe('cancelled');
    const confirmAfter = await client.callTool('confirm_booking', { booking_id: first.data.booking_id });
    expect(confirmAfter.ok).toBe(false);
  });

  it('reports unknown listings and bookings', async () => {
    const { client } = setup();
    const details = await client.callTool('get_listing_details', { listing_id: 'rest_999' });
    expect(!details.ok && details.error.code).toBe(ERROR_CODES.notFound);
    const booking = await client.callTool('get_booking', { booking_id: 'bk_9' });
    expect(!booking.ok && booking.error.code).toBe(ERROR_CODES.notFound);
  });
});
