import type { ToolArgs, ToolName, ToolOutputs } from '../contract/types';
import { CLIENT_ERROR_CODES, toolError } from '../mcp/result';
import type { ToolClient, ToolError, ToolOutcome } from '../mcp/types';
import type { Guest } from '../booking/flow';
import { itineraryReducer, releasableLegs, type ItineraryEvent } from './flow';
import * as replies from './replies';
import type { Itinerary } from './types';

// The plan's MCP sequences on the page's one ToolClient, so they run the same against the live
// server and demo data. Steps run one at a time and in leg order; releases run newest first.
// These functions only dispatch events and call tools; the reducer decides what each step may do.

export interface PlanRun {
  client: ToolClient;
  dispatch(event: ItineraryEvent): void;
  /** The plan as it is after every dispatch so far. */
  plan(): Itinerary;
}

/** A run over a plain variable, for tests and scripts without React. */
export function runOver(client: ToolClient, plan: Itinerary): PlanRun {
  let state = plan;
  return {
    client,
    dispatch: (event) => {
      state = itineraryReducer(state, event);
    },
    plan: () => state,
  };
}

// Failures with no answer from the server: the request may or may not have reached it.
const NO_ANSWER = new Set<string | null>([
  null,
  CLIENT_ERROR_CODES.unreachable,
  CLIENT_ERROR_CODES.sessionLost,
  CLIENT_ERROR_CODES.badResponse,
]);

const call = <N extends ToolName>(run: PlanRun, name: N, args: ToolArgs[N]): Promise<ToolOutcome<ToolOutputs[N]>> =>
  run.client.callTool(name, args);

async function searchLeg(run: PlanRun, index: number) {
  run.dispatch({ type: 'leg_search_started', index });
  const out = await call(run, 'search_availability', run.plan().legs[index].search);
  if (out.ok) run.dispatch({ type: 'leg_searched', index, results: Array.isArray(out.data.results) ? out.data.results : [] });
  else run.dispatch({ type: 'leg_search_failed', index, error: out.error });
}

/** Search every leg, one after another so the activity log reads in plan order. Nothing is held. */
export async function searchLegs(run: PlanRun): Promise<void> {
  for (const index of run.plan().legs.keys()) await searchLeg(run, index);
  run.dispatch({ type: 'searches_done' });
}

export async function retrySearch(run: PlanRun, index: number): Promise<void> {
  run.dispatch({ type: 'search_retry_started', index });
  if (run.plan().phase !== 'searching') return;
  await searchLeg(run, index);
  run.dispatch({ type: 'searches_done' });
}

/**
 * Hold every leg in order. If one fails, every earlier hold is released (and verified) before
 * the guest sees the failed leg's alternatives.
 */
export async function holdPlan(run: PlanRun, guest: Guest): Promise<'held' | 'failed' | 'refused'> {
  run.dispatch({ type: 'hold_started' });
  if (run.plan().phase !== 'holding') return 'refused';
  for (const index of run.plan().legs.keys()) {
    const leg = run.plan().legs[index];
    const slot = leg.selected!;
    run.dispatch({ type: 'leg_hold_started', index });
    const out = await call(run, 'create_booking_hold', {
      availability_id: slot.availability_id,
      guest_name: guest.guest_name,
      guest_contact: guest.guest_contact,
      party_size: slot.party_size,
    });
    if (!out.ok) {
      run.dispatch({ type: 'leg_hold_failed', index, error: out.error, mayBeHeld: NO_ANSWER.has(out.error.code) });
      await rollBack(run, replies.holdFailed(leg, out.error));
      return 'failed';
    }
    run.dispatch({ type: 'leg_held', index, result: out.data });
  }
  run.dispatch({ type: 'all_held' });
  return 'held';
}

/** Ask the server for every held leg; the first problem found, or null when all are still held. */
async function checkLegs(run: PlanRun): Promise<string | null> {
  for (const [index, leg] of run.plan().legs.entries()) {
    if (!leg.booking) continue;
    const out = await call(run, 'get_booking', { booking_id: leg.booking.booking_id });
    if (out.ok) run.dispatch({ type: 'leg_checked', index, result: out.data });
    else run.dispatch({ type: 'leg_check_failed', index, error: out.error });
  }
  for (const leg of run.plan().legs) {
    if (leg.error) return replies.checkFailed(leg, leg.error);
    if (leg.status !== 'held') return replies.lapsed(leg);
  }
  return null;
}

/**
 * Only ever called for the guest's own explicit approval. Every hold is verified first; if any is
 * gone, nothing is confirmed. If a confirmation fails, everything held or confirmed is released.
 */
export async function confirmPlan(run: PlanRun): Promise<'confirmed' | 'failed' | 'refused'> {
  run.dispatch({ type: 'approval_given' });
  if (run.plan().phase !== 'verifying') return 'refused';
  const problem = await checkLegs(run);
  if (problem) {
    await rollBack(run, problem);
    return 'failed';
  }
  run.dispatch({ type: 'verified' });
  for (const index of run.plan().legs.keys()) {
    const leg = run.plan().legs[index];
    run.dispatch({ type: 'leg_confirm_started', index });
    const out = await call(run, 'confirm_booking', { booking_id: leg.booking!.booking_id, user_confirmed: true });
    if (!out.ok) {
      run.dispatch({ type: 'leg_confirm_failed', index, error: out.error });
      await rollBack(run, replies.confirmFailed(leg, out.error));
      return 'failed';
    }
    run.dispatch({ type: 'leg_confirmed', index, result: out.data });
  }
  run.dispatch({ type: 'all_confirmed' });
  return 'confirmed';
}

/** The earliest hold's time is up: check every hold, and release the rest if any ran out. */
export async function checkHolds(run: PlanRun): Promise<'held' | 'released' | 'refused'> {
  run.dispatch({ type: 'check_started' });
  if (run.plan().phase !== 'awaiting_approval' || !run.plan().busy) return 'refused';
  const problem = await checkLegs(run);
  if (problem) {
    await rollBack(run, problem);
    return 'released';
  }
  run.dispatch({ type: 'check_done' });
  return 'held';
}

/** The guest's Cancel whole plan, before or after confirming. */
export async function cancelPlan(run: PlanRun): Promise<'cancelled' | 'cleanup_failed' | 'refused'> {
  run.dispatch({ type: 'cancel_started' });
  if (run.plan().phase !== 'cancelling') return 'refused';
  return finishRelease(run);
}

/** Release the legs whose cleanup was not verified, until the server says they are gone. */
export async function retryCleanup(run: PlanRun): Promise<'cancelled' | 'cleanup_failed' | 'refused'> {
  run.dispatch({ type: 'cleanup_retry_started' });
  if (run.plan().phase !== 'cancelling') return 'refused';
  return finishRelease(run);
}

async function finishRelease(run: PlanRun): Promise<'cancelled' | 'cleanup_failed'> {
  await releaseLegs(run);
  run.dispatch({ type: 'release_done' });
  return run.plan().phase === 'cancelled' ? 'cancelled' : 'cleanup_failed';
}

async function rollBack(run: PlanRun, notice: string) {
  run.dispatch({ type: 'rollback_started', notice });
  await releaseLegs(run);
  run.dispatch({ type: 'release_done' });
}

/**
 * Cancel every leg that may hold a booking, newest first, and verify each with get_booking. A leg
 * only counts as released when the server says cancelled or expired; anything else is unresolved.
 */
async function releaseLegs(run: PlanRun) {
  for (const index of releasableLegs(run.plan()).reverse()) {
    const { booking_id } = run.plan().legs[index].booking!;
    run.dispatch({ type: 'leg_release_started', index });
    // An expired hold answers invalid_state here; get_booking below is what decides.
    const cancelled = await call(run, 'cancel_booking', { booking_id });
    const check = await call(run, 'get_booking', { booking_id });
    const status = check.ok ? check.data.booking.status : null;
    if (check.ok && (status === 'cancelled' || status === 'expired')) {
      run.dispatch({ type: 'leg_released', index, result: check.data });
      continue;
    }
    const error: ToolError = !check.ok
      ? cancelled.ok
        ? check.error
        : cancelled.error
      : toolError(replies.stillActive(status ?? 'active'), null, { currentStatus: status });
    run.dispatch({ type: 'leg_unresolved', index, error });
  }
}
