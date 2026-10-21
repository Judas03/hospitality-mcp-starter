import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SearchAvailabilityInput, ToolOutputs } from '../contract/types';
import { DemoClient } from './demoClient';
import { LiveClient } from './liveClient';
import { CLIENT_ERROR_CODES } from './result';
import type { LogEntry, ServerInfo, ToolOutcome } from './types';

// Runs only against a running backend: MCP_TEST_URL=http://127.0.0.1:8000/mcp npm test
const MCP_TEST_URL = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MCP_TEST_URL;

// A date far from any demo recording, so these bookings never get in the way.
const DATE = '2027-01-15';
const base: SearchAvailabilityInput = {
  provider_type: 'restaurant',
  location: 'Bangkok',
  date: DATE,
  time: '19:00',
  party_size: 2,
  service_type: null,
  room_type: null,
  preferences: ['quiet'],
};
const guest = { guest_name: 'Demo Guest', guest_contact: 'demo@example.com' };

function data<T>(out: ToolOutcome<T>): T {
  if (!out.ok) throw new Error(`${out.error.code}: ${out.error.message}`);
  return out.data;
}

describe.skipIf(!MCP_TEST_URL)('LiveClient against the real MCP server', () => {
  const log: Array<Omit<LogEntry, 'id'>> = [];
  const live = new LiveClient(MCP_TEST_URL ?? '', (entry) => log.push(entry));
  const demo = new DemoClient(() => {}, { latencyMs: 0 });
  const bookings: string[] = [];
  let info: ServerInfo;

  beforeAll(async () => {
    info = await live.connect();
  });

  afterAll(async () => {
    for (const booking_id of bookings) await live.callTool('cancel_booking', { booking_id });
    await live.close();
  });

  it('does the 2025-11-25 handshake and lists exactly the seven contract tools', () => {
    expect(info.protocolVersion).toBe('2025-11-25');
    expect(info.sessionId).toBeTruthy();
    expect(info.tools.map((tool) => tool.name).sort()).toEqual([
      'cancel_booking',
      'confirm_booking',
      'create_booking_hold',
      'get_booking',
      'get_listing_details',
      'modify_booking',
      'search_availability',
    ]);
    expect(log.slice(0, 3).map((entry) => [entry.method, entry.mode, entry.ok])).toEqual([
      ['initialize', 'live', true],
      ['notifications/initialized', 'live', true],
      ['tools/list', 'live', true],
    ]);
  });

  it.each([
    ['a quiet table', {}],
    ['a table by the river', { preferences: ['river view'] }],
    ['an outdoor table for four', { party_size: 4, time: '19:30', preferences: ['outdoor seating'] }],
    ['a haircut', { provider_type: 'salon', time: '13:00', party_size: 1, service_type: 'haircut', preferences: [] }],
    ['any hotel room', { provider_type: 'hotel', time: '15:00', preferences: [] }],
    ['a suite for four', { provider_type: 'hotel', time: '15:00', party_size: 4, room_type: 'suite', preferences: [] }],
  ] as Array<[string, Partial<SearchAvailabilityInput>]>)('finds the same options as demo mode for %s', async (_, change) => {
    const input = { ...base, ...change };
    const fromLive = data(await live.callTool('search_availability', input));
    const fromDemo = data(await demo.callTool('search_availability', input));
    expect(fromLive.results.length).toBeGreaterThan(0);
    expect(fromDemo).toEqual(fromLive);
  });

  it('holds, confirms, refuses a double booking with alternatives, moves and cancels', async () => {
    const results = data(await live.callTool('search_availability', base)).results;
    const held = data(
      await live.callTool('create_booking_hold', { availability_id: results[0].availability_id, party_size: 2, ...guest }),
    );
    bookings.push(held.booking.booking_id);
    expect(held.booking.status).toBe('held');
    expect(held.booking.expires_at).toBeTruthy();

    const confirmed: ToolOutputs['confirm_booking'] = data(
      await live.callTool('confirm_booking', { booking_id: held.booking.booking_id, user_confirmed: true }),
    );
    expect(confirmed.booking).toMatchObject({ status: 'confirmed', expires_at: null });

    const clash = await live.callTool('create_booking_hold', { availability_id: results[0].availability_id, party_size: 2, ...guest });
    expect(clash.ok).toBe(false);
    if (!clash.ok) {
      expect(clash.error.code).toBe('slot_unavailable');
      expect(clash.error.alternatives.map((slot) => slot.start_time.slice(11, 16))).toEqual(['18:30', '19:30']);
    }

    const later = results.find((slot) => slot.start_time.slice(11, 16) === '19:30')!;
    const moved = data(
      await live.callTool('modify_booking', { booking_id: held.booking.booking_id, new_availability_id: later.availability_id }),
    );
    expect(moved.booking).toMatchObject({ status: 'confirmed', start_time: later.start_time });

    const cancelled = data(await live.callTool('cancel_booking', { booking_id: held.booking.booking_id }));
    expect(cancelled.booking.status).toBe('cancelled');
    expect(log.filter((entry) => entry.method === 'tools/call').map((entry) => entry.tool)).toContain('modify_booking');
  });

  it('loses a slot to another guest’s session, with the server’s alternatives', async () => {
    const other = new LiveClient(MCP_TEST_URL ?? '', () => {});
    const otherInfo = await other.connect();
    try {
      expect(otherInfo.sessionId).not.toBe(info.sessionId);
      const [best] = data(await live.callTool('search_availability', { ...base, time: '18:00' })).results;
      const taken = data(
        await other.callTool('create_booking_hold', {
          availability_id: best.availability_id,
          party_size: 2,
          guest_name: 'Another Guest',
          guest_contact: 'another.guest@example.com',
        }),
      );
      const mine = await live.callTool('create_booking_hold', { availability_id: best.availability_id, party_size: 2, ...guest });
      expect(!mine.ok && mine.error.code).toBe('slot_unavailable');
      expect(!mine.ok && mine.error.alternatives.length).toBeGreaterThan(0);
      await other.callTool('cancel_booking', { booking_id: taken.booking.booking_id });
    } finally {
      await other.close();
    }
  });

  it('reads input the server rejects as an invalid-input error', async () => {
    const out = await live.callTool('confirm_booking', { booking_id: 'nope', user_confirmed: 'yes' as unknown as true });
    expect(!out.ok && out.error.code).toBe(CLIENT_ERROR_CODES.invalidInput);
  });
});
