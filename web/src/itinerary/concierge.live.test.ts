import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BookingStatus, ToolName } from '../contract/types';
import { DemoClient } from '../mcp/demoClient';
import { LiveClient } from '../mcp/liveClient';
import { CLIENT_ERROR_CODES, toolError } from '../mcp/result';
import type { ToolClient } from '../mcp/types';
import { holdsBookings, RELEASED_NOTE, startItinerary } from './flow';
import { cancelPlan, checkUnknownHolds, confirmPlan, holdPlan, runOver, searchLegs } from './orchestrate';
import { parseItinerary } from './parseItinerary';
import { ScriptedClient } from './testClient';

// Runs only against a running backend: MCP_TEST_URL=http://127.0.0.1:8000/mcp npm test
const MCP_TEST_URL = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.MCP_TEST_URL;

// 16 January 2027: a day no other test or recording books, so every slot starts free.
const REQUEST =
  'Plan my anniversary on 16 January in Bangkok: a manicure for me at 3 PM, a quiet dinner for two at 7 PM, and a river-view hotel for two';
const GUEST = { guest_name: 'Demo Guest', guest_contact: 'demo@example.com' };
const RIVAL = { guest_name: 'Another Guest', guest_contact: 'another.guest@example.com' };

const repeat = (name: ToolName, times: number) => Array<ToolName>(times).fill(name);

describe.skipIf(!MCP_TEST_URL)('Occasion Concierge against the real MCP server', () => {
  const live = new LiveClient(MCP_TEST_URL ?? '', () => {});
  /** Another guest's own MCP session on the same server. */
  const rival = new LiveClient(MCP_TEST_URL ?? '', () => {});
  const created: string[] = [];

  beforeAll(async () => {
    await live.connect();
    await rival.connect();
  });

  afterAll(async () => {
    // Cancelling is idempotent, so everything any test held or booked is released.
    for (const booking_id of created) await live.callTool('cancel_booking', { booking_id });
    await live.close();
    await rival.close();
  });

  function plan() {
    const parsed = parseItinerary(REQUEST, new Date());
    if (parsed?.kind !== 'plan') throw new Error('the request is not a plan');
    expect(parsed.date).toBe('2027-01-16');
    const client = new ScriptedClient(live);
    return { client, run: runOver(client, startItinerary(parsed)) };
  }

  async function statusOf(client: ToolClient, booking_id: string): Promise<BookingStatus> {
    const out = await client.callTool('get_booking', { booking_id });
    if (!out.ok) throw new Error(out.error.message);
    return out.data.booking.status;
  }

  async function rivalHolds(availability_id: string, party_size: number): Promise<string> {
    const out = await rival.callTool('create_booking_hold', { availability_id, party_size, ...RIVAL });
    if (!out.ok) throw new Error(out.error.message);
    created.push(out.data.booking.booking_id);
    return out.data.booking.booking_id;
  }

  it('finds the same options as demo mode for every leg', async () => {
    const { run } = plan();
    const demo = new DemoClient(() => {}, { latencyMs: 0 });
    for (const leg of run.plan().legs) {
      const fromLive = await live.callTool('search_availability', leg.search);
      const fromDemo = await demo.callTool('search_availability', leg.search);
      expect(fromLive.ok && fromLive.data.results.length).toBeGreaterThan(0);
      expect(fromDemo).toEqual(fromLive);
    }
  });

  it('searches, holds, verifies and confirms all three, then Cancel whole plan releases every booking', async () => {
    const { client, run } = plan();
    await searchLegs(run);
    expect(run.plan().legs.map((leg) => leg.selected?.availability_id)).toEqual([
      'avail_salon_002_20270116_1500_manicure',
      'avail_rest_001_20270116_1900',
      'avail_hotel_001_20270116_1500_standard',
    ]);
    expect(await holdPlan(run, GUEST)).toBe('held');
    created.push(...client.holds);
    expect(await confirmPlan(run)).toBe('confirmed');
    expect(client.names()).toEqual([
      ...repeat('search_availability', 3),
      ...repeat('create_booking_hold', 3),
      ...repeat('get_booking', 3),
      ...repeat('confirm_booking', 3),
    ]);
    for (const id of client.holds) expect(await statusOf(rival, id)).toBe('confirmed');

    expect(await cancelPlan(run)).toBe('cancelled');
    for (const id of client.holds) expect(await statusOf(rival, id)).toBe('cancelled');
    expect(holdsBookings(run.plan())).toBe(false);
  });

  it('releases the first hold when another guest has taken the table, and offers nearby times', async () => {
    const { client, run } = plan();
    await searchLegs(run);
    const taken = await rivalHolds(run.plan().legs[1].selected!.availability_id, 2);

    expect(await holdPlan(run, GUEST)).toBe('failed');
    created.push(...client.holds);
    const after = run.plan();
    expect(after.phase).toBe('ready');
    expect(after.legs.map((leg) => [leg.status, leg.note])).toEqual([
      ['selected', RELEASED_NOTE],
      ['failed', null],
      ['selected', null],
    ]);
    expect(after.legs[1].error?.code).toBe('slot_unavailable');
    expect(after.legs[1].alternatives.length).toBeGreaterThan(0);
    expect(client.holds).toHaveLength(1);
    expect(await statusOf(rival, client.holds[0])).toBe('cancelled');
    expect(await statusOf(rival, taken)).toBe('held'); // the other guest's hold is not touched
    await rival.callTool('cancel_booking', { booking_id: taken });
  });

  it('releases both earlier holds when another guest has taken the room', async () => {
    const { client, run } = plan();
    await searchLegs(run);
    const taken = await rivalHolds(run.plan().legs[2].selected!.availability_id, 2);

    expect(await holdPlan(run, GUEST)).toBe('failed');
    created.push(...client.holds);
    expect(client.holds).toHaveLength(2);
    expect(client.argsOf('cancel_booking').map((args) => args.booking_id)).toEqual([client.holds[1], client.holds[0]]);
    for (const id of client.holds) expect(await statusOf(rival, id)).toBe('cancelled');
    expect(run.plan().legs[2]).toMatchObject({ status: 'failed', error: { code: 'slot_unavailable' } });
    await rival.callTool('cancel_booking', { booking_id: taken });
  });

  it('stays locked while a hold whose answer was lost exists, and unlocks once a fresh search shows the room free', async () => {
    const { client, run } = plan();
    client.on('create_booking_hold', 3, { lose: toolError('Failed to fetch', CLIENT_ERROR_CODES.unreachable) });
    await searchLegs(run);
    expect(await holdPlan(run, GUEST)).toBe('failed');
    created.push(...client.holds);
    const hidden = client.holds[2];
    expect(await statusOf(rival, hidden)).toBe('held');
    expect(holdsBookings(run.plan())).toBe(true);
    expect(await checkUnknownHolds(run)).toBe('still_unknown');

    // Once that hold is gone (cancelled here, rather than waiting five minutes), the room is free again.
    await live.callTool('cancel_booking', { booking_id: hidden });
    expect(await checkUnknownHolds(run)).toBe('cleared');
    expect(holdsBookings(run.plan())).toBe(false);
  });
});
