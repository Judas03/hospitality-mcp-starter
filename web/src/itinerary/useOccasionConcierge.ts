import { useEffect, useMemo, useRef, useState } from 'react';
import type { Agent } from '../booking/useBookingAgent';
import type { Availability } from '../contract/types';
import { BUSY, negated } from '../conversation/replies';
import { negatedAction } from '../conversation/understand';
import type { ToolClient } from '../mcp/types';
import {
  canHoldPlan,
  earliestExpiry,
  hasUnknownHold,
  holdsBookings,
  itineraryReducer,
  startItinerary,
  unknownHoldsUntil,
} from './flow';
import * as steps from './orchestrate';
import { parseItinerary } from './parseItinerary';
import * as replies from './replies';
import type { Itinerary, ParsedItinerary } from './types';

// Runs the Occasion Concierge next to the single-booking agent: every message goes through send,
// which hands the plan's own commands and compound requests to the plan and everything else to the
// agent. Only one tool step runs at a time across both, and a plan that holds bookings can't be
// closed or replaced until they are confirmed or verified released.

/** What the conversation shows while a plan step runs. */
export type PlanTask = 'plan_search' | 'plan_hold' | 'plan_confirm' | 'plan_release' | 'plan_check';

export interface Concierge {
  plan: Itinerary | null;
  /** The plan panel is on screen; a booked plan can be put away and shown again. */
  open: boolean;
  /** A plan step is running. */
  task: PlanTask | null;
  /** Chips while the plan is on screen, otherwise null. */
  suggestions: string[] | null;
  /** The page's one way in for typed, spoken and suggested text. */
  send(text: string): void;
  holdPlan(): void;
  confirmPlan(): void;
  cancelPlan(): void;
  retryCleanup(): void;
  retrySearch(index: number): void;
  pickOption(index: number, slot: Availability): void;
  removeLeg(index: number): void;
  /** Looks again for a hold that got no answer, with a fresh search. */
  checkAgain(): void;
  /** Drops a plan that holds nothing, or puts a booked plan away. False when it can't. */
  close(): boolean;
  show(): void;
}

function taskOf(plan: Itinerary | null): PlanTask | null {
  if (!plan?.busy) return null;
  switch (plan.phase) {
    case 'searching':
      return 'plan_search';
    case 'holding':
      return 'plan_hold';
    case 'verifying':
    case 'confirming':
      return 'plan_confirm';
    case 'awaiting_approval':
      return 'plan_check';
    default:
      return 'plan_release';
  }
}

export function planSuggestions(plan: Itinerary): string[] | null {
  if (hasUnknownHold(plan)) return plan.busy ? [] : ['Check the hold again'];
  switch (plan.phase) {
    case 'ready':
      return canHoldPlan(plan) ? ['Hold the whole plan', 'Drop the plan'] : ['Drop the plan'];
    case 'awaiting_approval':
      return ['Yes, confirm the whole plan', 'No, cancel the plan'];
    case 'confirmed':
      return ['Cancel the whole plan'];
    case 'cleanup_failed':
      return ['Retry cleanup'];
    case 'cancelled':
      return null;
    default:
      return [];
  }
}

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|please do|go ahead|do it|sounds good|perfect)\b/;
const NO = /^(no|nope|nah|not now|never ?mind)\b/;
const PLAN_WORDS = /\b(plan|everything|all of them|all three|both|them all|whole thing)\b/;

export type Command = 'hold' | 'drop' | 'confirm' | 'cancel' | 'retry' | 'show' | 'already_booked' | 'check' | 'negated';

/** Commands that hold, confirm, cancel or drop something, so "don't …" must stop them. */
const ACTIONS: Command[] = ['hold', 'drop', 'confirm', 'cancel', 'retry'];

/**
 * The plan's own commands, by phase. Anything else falls through to compound requests or the agent.
 * A negated action ("Do not confirm the plan") is 'negated': it is answered and does nothing.
 */
export function commandFor(text: string, plan: Itinerary, open: boolean): Command | null {
  const command = readCommand(text, plan, open);
  return command && ACTIONS.includes(command) && negatedAction(text) ? 'negated' : command;
}

function readCommand(text: string, plan: Itinerary, open: boolean): Command | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (hasUnknownHold(plan) && /\b(check|look)\b/.test(t)) return 'check';
  switch (plan.phase) {
    case 'ready':
      if ((/\b(drop|forget|cancel|scrap)\b/.test(t) && PLAN_WORDS.test(t)) || (open && NO.test(t))) return 'drop';
      if ((open && YES.test(t)) || (/\b(hold|book|reserve)\b/.test(t) && PLAN_WORDS.test(t))) return 'hold';
      return null;
    case 'awaiting_approval':
      if (NO.test(t) || /\b(cancel|release|let (it|them) go|drop)\b/.test(t)) return 'cancel';
      if (YES.test(t) || /\bconfirm\b/.test(t)) return 'confirm';
      return null;
    case 'confirmed':
      if (/\b(show|open|see|view)\b/.test(t) && /\bplan\b/.test(t)) return 'show';
      // While the plan is on screen, "cancel" means the plan; once put away, only when it says so.
      if (/\bcancel\b/.test(t) && (open || PLAN_WORDS.test(t))) return 'cancel';
      if (open && (YES.test(t) || /\bconfirm\b/.test(t))) return 'already_booked';
      return null;
    case 'cleanup_failed':
      if (YES.test(t) || /\b(retry|try again|clean ?up)\b/.test(t)) return 'retry';
      return null;
    default:
      return null;
  }
}

/**
 * Whether the plan answers every message: it holds bookings and waits for the guest, or a hold got
 * no answer and may still exist.
 */
function claimsAll(plan: Itinerary): boolean {
  return plan.phase === 'awaiting_approval' || plan.phase === 'cleanup_failed' || hasUnknownHold(plan);
}

export function useOccasionConcierge(client: ToolClient, agent: Agent, now: () => Date = () => new Date()): Concierge {
  const [plan, setPlan] = useState<Itinerary | null>(null);
  const [open, setOpen] = useState(false);
  // Steps read and update the plan synchronously, between awaits, through these refs.
  const planRef = useRef<Itinerary | null>(null);
  const openRef = useRef(false);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const nowRef = useRef(now);
  nowRef.current = now;

  const actions = useMemo(() => {
    const setCurrent = (next: Itinerary | null) => {
      planRef.current = next;
      setPlan(next);
    };
    const setShown = (shown: boolean) => {
      openRef.current = shown;
      setOpen(shown);
    };
    const run: steps.PlanRun = {
      client,
      dispatch: (event) => {
        if (planRef.current) setCurrent(itineraryReducer(planRef.current, event));
      },
      plan: () => planRef.current!,
      now: () => Date.now(),
    };
    const say = (text: string) => agentRef.current.addMessage('assistant', text);
    /** Either flow has a tool step running. */
    const blocked = () => agentRef.current.state.busy !== null || (planRef.current?.busy ?? false);
    const afterRollback = (current: Itinerary) =>
      current.phase === 'cleanup_failed' ? replies.cleanupFailed(current) : replies.rolledBack(current);
    const waitingFor = (current: Itinerary) =>
      hasUnknownHold(current) ? replies.unknownHoldWaiting(current) : replies.waiting(current);

    /** Runs a plan step unless something else is running. */
    const step = (work: (current: Itinerary) => Promise<void> | void) => {
      const current = planRef.current;
      if (!current) return;
      if (blocked()) return say(BUSY);
      void work(current);
    };

    async function start(parsed: ParsedItinerary) {
      if (parsed.kind === 'unsupported') return say(replies.unsupported(parsed.reason));
      const current = planRef.current;
      if (current && holdsBookings(current)) {
        return say(hasUnknownHold(current) ? replies.unknownHoldWaiting(current) : replies.ALREADY_PLANNED);
      }
      // A hold from the single-booking flow is released, and verified, before the plan starts.
      const single = agentRef.current.state.current;
      if (single?.booking.status === 'held') {
        if (!(await agentRef.current.releaseHold())) return say(replies.handoffFailed(single.slot.name));
        say(replies.handoffReleased(single.slot.name));
      }
      setCurrent(startItinerary(parsed));
      setShown(true);
      await steps.searchLegs(run);
      say(replies.planned(run.plan()));
    }

    const holdPlan = () =>
      step(async (current) => {
        if (hasUnknownHold(current)) return say(replies.unknownHoldWaiting(current));
        if (!canHoldPlan(current)) return say(replies.notReady(current));
        const outcome = await steps.holdPlan(run, agentRef.current.guest);
        if (outcome === 'held') say(replies.allHeld(run.plan()));
        else if (outcome === 'failed') say(afterRollback(run.plan()));
      });

    // Only ever called for the guest's own yes or Confirm whole plan click.
    const confirmPlan = () =>
      step(async () => {
        const outcome = await steps.confirmPlan(run);
        if (outcome === 'confirmed') say(replies.confirmed(run.plan()));
        else if (outcome === 'failed') say(afterRollback(run.plan()));
      });

    const finishCleanup = (outcome: 'cancelled' | 'cleanup_failed' | 'refused') => {
      if (outcome === 'cancelled') say(replies.CANCELLED);
      else if (outcome === 'cleanup_failed') say(replies.cleanupFailed(run.plan()));
    };
    const cancelPlan = () => step(async () => finishCleanup(await steps.cancelPlan(run)));
    const retryCleanup = () => step(async () => finishCleanup(await steps.retryCleanup(run)));

    const retrySearch = (index: number) =>
      step(async () => {
        await steps.retrySearch(run, index);
        say(replies.planned(run.plan()));
      });

    const pickOption = (index: number, slot: Availability) => step(() => run.dispatch({ type: 'option_picked', index, slot }));

    const removeLeg = (index: number) =>
      step((current) => {
        const leg = current.legs[index];
        run.dispatch({ type: 'leg_removed', index });
        if (run.plan() !== current) say(replies.removed(leg, canHoldPlan(run.plan())));
      });

    const close = (): boolean => {
      const current = planRef.current;
      if (!current || current.busy) return false;
      if (current.phase === 'confirmed' && !hasUnknownHold(current)) {
        setShown(false);
        return true;
      }
      if (holdsBookings(current)) return false;
      setCurrent(null);
      setShown(false);
      return true;
    };

    /** The earliest hold's time is up while waiting for approval. Silent unless something ran out. */
    async function checkExpiry() {
      if (planRef.current?.phase !== 'awaiting_approval' || blocked()) return;
      if ((await steps.checkHolds(run)) === 'released') say(afterRollback(run.plan()));
    }

    const checkAgain = () =>
      step(async (current) => {
        if (!hasUnknownHold(current)) return;
        const outcome = await steps.checkUnknownHolds(run);
        if (outcome === 'cleared') say(replies.unknownHoldCleared(run.plan()));
        else if (outcome === 'still_unknown') say(replies.unknownHoldStill(run.plan()));
      });

    /** A hold that got no answer has certainly run out by now. Silent unless it clears. */
    async function checkUnknownLapsed() {
      if (!planRef.current || !hasUnknownHold(planRef.current) || blocked()) return;
      if ((await steps.checkUnknownHolds(run)) === 'cleared') say(replies.unknownHoldCleared(run.plan()));
    }

    function runCommand(command: Command, text: string) {
      switch (command) {
        case 'hold':
          return holdPlan();
        case 'confirm':
          return confirmPlan();
        case 'cancel':
          return cancelPlan();
        case 'retry':
          return retryCleanup();
        case 'show':
          return setShown(true);
        case 'already_booked':
          return say(replies.ALREADY_BOOKED);
        case 'check':
          return checkAgain();
        case 'negated':
          return say(negated(negatedAction(text) ?? 'do'));
        case 'drop': {
          const current = planRef.current;
          if (close()) return say(replies.DROPPED);
          return current ? say(waitingFor(current)) : undefined;
        }
      }
    }

    function send(text: string) {
      const current = planRef.current;
      const agentNow = agentRef.current;
      if (blocked()) {
        agentNow.addMessage('user', text);
        return say(BUSY);
      }
      if (current) {
        const command = commandFor(text, current, openRef.current);
        if (command || claimsAll(current)) {
          agentNow.addMessage('user', text);
          return command ? runCommand(command, text) : say(waitingFor(current));
        }
      }
      const parsed = parseItinerary(text, nowRef.current());
      if (parsed) {
        agentNow.addMessage('user', text);
        return void start(parsed);
      }
      // A single request: a plan that holds nothing makes way, a booked one is put away.
      if (current) close();
      agentNow.send(text);
    }

    return {
      send,
      holdPlan,
      confirmPlan,
      cancelPlan,
      retryCleanup,
      retrySearch,
      pickOption,
      removeLeg,
      close,
      show: () => setShown(true),
      checkAgain,
      checkExpiry,
      checkUnknownLapsed,
    };
  }, [client]);

  // Clear a hold that got no answer as soon as it has certainly run out.
  const unknownUntil = plan && !plan.busy ? unknownHoldsUntil(plan) : null;
  useEffect(() => {
    if (unknownUntil === null) return;
    const timer = window.setTimeout(() => void actions.checkUnknownLapsed(), Math.max(unknownUntil - Date.now() + 300, 0));
    return () => window.clearTimeout(timer);
  }, [unknownUntil, actions]);

  // Check the holds with the server when the earliest one is due, at most every two seconds.
  const expiresAt = plan ? (earliestExpiry(plan)?.at ?? null) : null;
  const watching = plan?.phase === 'awaiting_approval' && !plan.busy && expiresAt !== null;
  const lastCheck = useRef(0);
  useEffect(() => {
    if (!watching || expiresAt === null) return;
    const wait = Math.max(expiresAt - Date.now() + 300, lastCheck.current + 2000 - Date.now(), 0);
    const timer = window.setTimeout(() => {
      lastCheck.current = Date.now();
      void actions.checkExpiry();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [watching, expiresAt, actions]);

  return {
    plan,
    open: open && plan !== null,
    task: taskOf(plan),
    suggestions: plan && open ? planSuggestions(plan) : null,
    send: actions.send,
    holdPlan: actions.holdPlan,
    confirmPlan: actions.confirmPlan,
    cancelPlan: actions.cancelPlan,
    retryCleanup: actions.retryCleanup,
    retrySearch: actions.retrySearch,
    pickOption: actions.pickOption,
    removeLeg: actions.removeLeg,
    checkAgain: actions.checkAgain,
    close: actions.close,
    show: actions.show,
  };
}
