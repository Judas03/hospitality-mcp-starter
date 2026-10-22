import { describe, expect, it } from 'vitest';
import type { BookingStatus, ToolArgs, ToolName, ToolOutputs } from '../contract/types';
import { DemoClient } from '../mcp/demoClient';
import { CLIENT_ERROR_CODES, toolError } from '../mcp/result';
import type { ServerInfo, ToolClient, ToolError, ToolOutcome } from '../mcp/types';
import { canHoldPlan, earliestExpiry, holdsBookings, RAN_OUT_NOTE, RELEASED_NOTE, startItinerary, unresolvedLegs } from './flow';
import { cancelPlan, checkHolds, confirmPlan, holdPlan, retryCleanup, runOver, searchLegs } from './orchestrate';
import { parseItinerary } from './parseItinerary';

// Thursday 22 October 2026, 14:00 in Bangkok.
const START = Date.parse('2026-10-22T07:00:00Z');
const EXAMPLE =
  'Plan my anniversary tomorrow in Bangkok: a manicure for me at 3 PM, a quiet dinner for two at 7 PM, and a river-view hotel for two.';
const GUEST = { guest_name: 'Demo Guest', guest_contact: 'demo@example.com' };
const NO_ANSWER = toolError('Failed to fetch', CLIENT_ERROR_CODES.unreachable);

type Rule = { fail?: ToolError; after?: () => void };

/** Demo data with failures injected at chosen calls, recording every call in order. */
class ScriptedClient implements ToolClient {
  readonly mode = 'demo' as const;
  readonly endpoint = null;
  readonly calls: Array<{ name: ToolName; args: unknown }> = [];
  /** Booking IDs of every hold the server created, in order. */
  readonly holds: string[] = [];
  private readonly rules = new Map<string, Rule>();
  private readonly counts = new Map<ToolName, number>();

  constructor(private readonly inner: ToolClient) {}

  /** What the nth call of this tool (counting from 1) does instead of, or after, the real call. */
  on(name: ToolName, nth: number, rule: Rule) {
    this.rules.set(`${name}#${nth}`, rule);
    return this;
  }

  names() {
    return this.calls.map((call) => call.name);
  }

  argsOf<N extends ToolName>(name: N): Array<ToolArgs[N]> {
    return this.calls.filter((call) => call.name === name).map((call) => call.args as ToolArgs[N]);
  }

  connect(): Promise<ServerInfo> {
    return this.inner.connect();
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  async callTool<N extends ToolName>(name: N, args: ToolArgs[N]): Promise<ToolOutcome<ToolOutputs[N]>> {
    this.calls.push({ name, args });
    const nth = (this.counts.get(name) ?? 0) + 1;
    this.counts.set(name, nth);
    const rule = this.rules.get(`${name}#${nth}`);
    if (rule?.fail) return { ok: false, error: rule.fail };
    const out = await this.inner.callTool(name, args);
    if (out.ok && name === 'create_booking_hold') this.holds.push((out.data as ToolOutputs['create_booking_hold']).booking.booking_id);
    rule?.after?.();
    return out;
  }
}

function setup() {
  let now = START;
  const demo = new DemoClient(() => {}, { now: () => new Date(now), latencyMs: 0 });
  const client = new ScriptedClient(demo);
  const parsed = parseItinerary(EXAMPLE, new Date(now));
  if (parsed?.kind !== 'plan') throw new Error('example is not a plan');
  const run = runOver(client, startItinerary(parsed));
  /** Another guest on the same demo data. */
  const rival = demo.withLog(() => {});
  const statusOf = async (booking_id: string): Promise<BookingStatus> => {
    const out = await demo.callTool('get_booking', { booking_id });
    if (!out.ok) throw new Error(out.error.message);
    return out.data.booking.status;
  };
  const rivalHolds = async (availability_id: string, party_size: number) => {
    const out = await rival.callTool('create_booking_hold', { availability_id, party_size, guest_name: 'Another Guest', guest_contact: 'x@example.com' });
    if (!out.ok) throw new Error(out.error.message);
  };
  return { client, run, statusOf, rivalHolds, advance: (seconds: number) => (now += seconds * 1000) };
}

const repeat = (name: ToolName, times: number) => Array<ToolName>(times).fill(name);
const statuses = (statusOf: (id: string) => Promise<BookingStatus>, ids: string[]) => Promise.all(ids.map(statusOf));
const timeOf = (slot: { start_time: string }) => slot.start_time.slice(11, 16);

describe('the whole plan', () => {
  it('searches, holds only after Hold whole plan, verifies every hold, then confirms', async () => {
    const { client, run, statusOf } = setup();
    await searchLegs(run);
    expect(run.plan().phase).toBe('ready');
    expect(run.plan().legs.map((leg) => leg.selected?.availability_id)).toEqual([
      'avail_salon_002_20261023_1500_manicure', // not Lotus Glow's cheaper manicure at 2 PM
      'avail_rest_001_20261023_1900',
      'avail_hotel_001_20261023_1500_standard', // the cheaper room at the same place and time
    ]);
    expect(client.names()).toEqual(repeat('search_availability', 3));

    expect(await confirmPlan(run)).toBe('refused');
    expect(await holdPlan(run, GUEST)).toBe('held');
    expect(run.plan().phase).toBe('awaiting_approval');
    expect(client.argsOf('create_booking_hold').map((args) => args.party_size)).toEqual([1, 2, 2]);

    expect(await confirmPlan(run)).toBe('confirmed');
    expect(client.names()).toEqual([
      ...repeat('search_availability', 3),
      ...repeat('create_booking_hold', 3),
      ...repeat('get_booking', 3),
      ...repeat('confirm_booking', 3),
    ]);
    expect(client.argsOf('confirm_booking').every((args) => args.user_confirmed === true)).toBe(true);
    expect(await statuses(statusOf, client.holds)).toEqual(['confirmed', 'confirmed', 'confirmed']);
  });
});

describe('a refused hold', () => {
  it('on the second leg releases the first and never holds the third', async () => {
    const { client, run, statusOf, rivalHolds } = setup();
    await searchLegs(run);
    await rivalHolds('avail_rest_001_20261023_1900', 2);

    expect(await holdPlan(run, GUEST)).toBe('failed');
    const plan = run.plan();
    expect(plan.phase).toBe('ready');
    expect(plan.notice).toBe('The table at Siam Serenity couldn’t be held: That time is no longer available.');
    expect(plan.legs.map((leg) => [leg.status, leg.note])).toEqual([
      ['selected', RELEASED_NOTE],
      ['failed', null],
      ['selected', null],
    ]);
    expect(plan.legs[1].alternatives.map(timeOf)).toEqual(['18:30', '19:30']);
    expect(client.names().slice(3)).toEqual(['create_booking_hold', 'create_booking_hold', 'cancel_booking', 'get_booking']);
    expect(await statuses(statusOf, client.holds)).toEqual(['cancelled']);
    expect(holdsBookings(plan)).toBe(false);

    // Picking one of the alternatives makes the plan holdable again.
    run.dispatch({ type: 'option_picked', index: 1, slot: plan.legs[1].alternatives[1] });
    expect(canHoldPlan(run.plan())).toBe(true);
    expect(await holdPlan(run, GUEST)).toBe('held');
  });

  it('on the third leg releases both earlier holds, newest first', async () => {
    const { client, run, statusOf, rivalHolds } = setup();
    await searchLegs(run);
    await rivalHolds('avail_hotel_001_20261023_1500_standard', 2);

    expect(await holdPlan(run, GUEST)).toBe('failed');
    expect(client.names().slice(3)).toEqual([
      ...repeat('create_booking_hold', 3),
      'cancel_booking',
      'get_booking',
      'cancel_booking',
      'get_booking',
    ]);
    expect(client.argsOf('cancel_booking').map((args) => args.booking_id)).toEqual([client.holds[1], client.holds[0]]);
    expect(await statuses(statusOf, client.holds)).toEqual(['cancelled', 'cancelled']);

    // The hotel has no other time, but its deluxe room is still among the leg's options.
    const hotel = run.plan().legs[2];
    expect(hotel).toMatchObject({ status: 'failed', alternatives: [], mayBeHeld: false });
    run.dispatch({ type: 'option_picked', index: 2, slot: hotel.options.find((slot) => slot.room_type === 'deluxe')! });
    expect(await holdPlan(run, GUEST)).toBe('held');
  });

  it('without any answer may still exist on the server, and the plan says so', async () => {
    const { client, run } = setup();
    client.on('create_booking_hold', 3, { fail: NO_ANSWER });
    await searchLegs(run);
    expect(await holdPlan(run, GUEST)).toBe('failed');
    expect(run.plan().legs.map((leg) => leg.mayBeHeld)).toEqual([false, false, true]);
  });
});

describe('hold expiry', () => {
  it('releases the other legs when the earliest hold runs out before approval, and confirms nothing', async () => {
    const { client, run, statusOf, advance } = setup();
    // The manicure is held 200 seconds before the other two, so it runs out first.
    client.on('create_booking_hold', 1, { after: () => advance(200) });
    await searchLegs(run);
    await holdPlan(run, GUEST);
    expect(earliestExpiry(run.plan())?.leg.provider).toBe('salon');

    expect(await checkHolds(run)).toBe('held');
    expect(run.plan()).toMatchObject({ phase: 'awaiting_approval', busy: false });

    advance(101);
    expect(await checkHolds(run)).toBe('released');
    expect(run.plan().phase).toBe('ready');
    expect(run.plan().notice).toBe('The hold on the manicure at Sukhumvit Style Studio ran out before the plan was confirmed.');
    expect(run.plan().legs.map((leg) => leg.note)).toEqual([RAN_OUT_NOTE, RELEASED_NOTE, RELEASED_NOTE]);
    expect(await statuses(statusOf, client.holds)).toEqual(['expired', 'cancelled', 'cancelled']);
    expect(client.names()).not.toContain('confirm_booking');
  });

  it('confirms nothing when approval comes after a hold ran out', async () => {
    const { client, run, advance } = setup();
    await searchLegs(run);
    await holdPlan(run, GUEST);
    advance(301);
    expect(await confirmPlan(run)).toBe('failed');
    expect(client.names()).not.toContain('confirm_booking');
    expect(run.plan().phase).toBe('ready');
    expect(canHoldPlan(run.plan())).toBe(true);
  });
});

describe('a failed confirmation', () => {
  it('cancels the confirmed first leg and the held ones, and verifies each', async () => {
    const { client, run, statusOf } = setup();
    client.on('confirm_booking', 2, { fail: NO_ANSWER });
    await searchLegs(run);
    await holdPlan(run, GUEST);

    expect(await confirmPlan(run)).toBe('failed');
    expect(await statuses(statusOf, client.holds)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(run.plan().notice).toBe('The table at Siam Serenity couldn’t be confirmed: Failed to fetch');
    expect(holdsBookings(run.plan())).toBe(false);
    expect(run.plan().phase).toBe('ready');
  });
});

describe('Cancel whole plan', () => {
  it('releases every hold before approval', async () => {
    const { client, run, statusOf } = setup();
    await searchLegs(run);
    expect(await cancelPlan(run)).toBe('refused');
    await holdPlan(run, GUEST);
    expect(await cancelPlan(run)).toBe('cancelled');
    expect(run.plan().legs.map((leg) => leg.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
    expect(await statuses(statusOf, client.holds)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('cancels every booking after confirming', async () => {
    const { client, run, statusOf } = setup();
    await searchLegs(run);
    await holdPlan(run, GUEST);
    await confirmPlan(run);
    expect(await cancelPlan(run)).toBe('cancelled');
    expect(await statuses(statusOf, client.holds)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('counts a hold that ran out as released', async () => {
    const { run, advance } = setup();
    await searchLegs(run);
    await holdPlan(run, GUEST);
    advance(301);
    expect(await cancelPlan(run)).toBe('cancelled');
    expect(run.plan().legs.map((leg) => leg.status)).toEqual(['expired', 'expired', 'expired']);
  });
});

describe('cleanup that the server has not verified', () => {
  it('keeps a failed cancellation unresolved until Retry cleanup verifies it', async () => {
    const { client, run, statusOf } = setup();
    await searchLegs(run);
    await holdPlan(run, GUEST);
    client.on('cancel_booking', 1, { fail: NO_ANSWER }); // the newest leg is released first

    expect(await cancelPlan(run)).toBe('cleanup_failed');
    expect(unresolvedLegs(run.plan()).map((leg) => leg.booking?.booking_id)).toEqual([client.holds[2]]);
    expect(run.plan().legs.map((leg) => leg.status)).toEqual(['cancelled', 'cancelled', 'unresolved']);
    expect(holdsBookings(run.plan())).toBe(true);
    expect(await statusOf(client.holds[2])).toBe('held');

    expect(await retryCleanup(run)).toBe('cancelled');
    expect(await statuses(statusOf, client.holds)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('does not trust a cancellation it could not check', async () => {
    const { client, run } = setup();
    await searchLegs(run);
    await holdPlan(run, GUEST);
    client.on('get_booking', 1, { fail: NO_ANSWER });

    expect(await cancelPlan(run)).toBe('cleanup_failed');
    expect(run.plan().legs[2]).toMatchObject({ status: 'unresolved', error: { message: 'Failed to fetch' } });
    expect(await retryCleanup(run)).toBe('cancelled');
  });
});
