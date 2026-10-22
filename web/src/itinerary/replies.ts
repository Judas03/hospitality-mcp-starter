import { describeSearch } from '../conversation/replies';
import { formatDate, formatTime } from '../lib/time';
import type { ToolError } from '../mcp/types';
import { canHoldPlan, earliestExpiry, RELEASED_NOTE, unresolvedLegs } from './flow';
import type { Itinerary, Leg, UnknownHold } from './types';

// What the concierge says. Notices explain the last failure on the panel; chat replies follow it.

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "a, b and c", or "a or b" */
export function listJoin(items: string[], word = 'and'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`;
}

/** "both", "all three" */
function every(count: number): string {
  return count === 2 ? 'both' : `all ${['', 'one', 'two', 'three'][count] ?? count}`;
}

/** "manicure", "table", "standard room" */
export function legKind(leg: Leg): string {
  const option = leg.selected ?? null;
  if (leg.provider === 'salon') return option?.service_type ?? leg.search.service_type ?? 'salon visit';
  if (leg.provider === 'hotel') {
    const room = option?.room_type ?? leg.search.room_type;
    return room ? `${room} room` : 'hotel room';
  }
  return 'table';
}

/** "the manicure at Sukhumvit Style Studio" */
export function describeLeg(leg: Leg): string {
  return leg.selected ? `the ${legKind(leg)} at ${leg.selected.name}` : `the ${legKind(leg)}`;
}

/** "a table for 2 at Siam Serenity at 7:00 PM" */
export function legLine(leg: Leg): string {
  const slot = leg.selected;
  if (!slot) return describeLeg(leg);
  const time = formatTime(slot.start_time);
  if (leg.provider === 'hotel') return `a ${legKind(leg)} at ${slot.name} from ${time}`;
  if (leg.provider === 'restaurant') return `a table for ${slot.party_size} at ${slot.name} at ${time}`;
  return `a ${legKind(leg)} at ${slot.name} at ${time}`;
}

// Notices, set when a step fails.

export function holdFailed(leg: Leg, error: ToolError): string {
  return `${capitalize(describeLeg(leg))} couldn’t be held: ${error.message}`;
}

export function lapsed(leg: Leg): string {
  return `The hold on ${describeLeg(leg)} ran out before the plan was confirmed.`;
}

export function checkFailed(leg: Leg, error: ToolError): string {
  return `I couldn’t check the hold on ${describeLeg(leg)}: ${error.message}`;
}

export function confirmFailed(leg: Leg, error: ToolError): string {
  return `${capitalize(describeLeg(leg))} couldn’t be confirmed: ${error.message}`;
}

export function stillActive(status: string): string {
  return `The server still shows this booking as ${status}.`;
}

// Chat replies.

const clockAt = (epochMs: number) => formatTime(new Date(epochMs).toISOString());

/** A hold that got no answer, as the panel and the chat describe it. */
export function unknownHold(hold: UnknownHold): string {
  return `No answer came back for the hold at ${hold.name}, so it may still be on the server until ${clockAt(hold.until)}. The plan stays locked until then.`;
}

export const UNKNOWN_HOLD_RAN_OUT = 'The hold that got no answer has run out by now.';
export const UNKNOWN_HOLD_FREE = 'A fresh search shows this option free, so no hold is left on it.';

/** The reply to anything else while a hold that got no answer may still exist. */
export function unknownHoldWaiting(plan: Itinerary): string {
  const hold = plan.legs.find((leg) => leg.mayBeHeld)?.mayBeHeld;
  if (!hold) return waiting(plan);
  return `The hold at ${hold.name} got no answer, so it may still exist until ${clockAt(hold.until)}. Nothing else can start until that’s cleared. Say “check again” to look now.`;
}

export function unknownHoldCleared(plan: Itinerary): string {
  const next = canHoldPlan(plan)
    ? ' Shall I hold the plan again?'
    : plan.phase === 'ready'
      ? ' Pick an option for every part, then hold the plan again.'
      : '';
  return `The hold that got no answer is cleared: nothing is left on the server.${next}`;
}

export function unknownHoldStill(plan: Itinerary): string {
  const hold = plan.legs.find((leg) => leg.mayBeHeld)?.mayBeHeld;
  if (!hold) return unknownHoldCleared(plan);
  return `I still can’t tell whether the hold at ${hold.name} exists: that option isn’t free in a fresh search. It will have run out by ${clockAt(hold.until)}, and I’ll check again then.`;
}

export const DROPPED = 'Okay, I dropped the plan. Nothing was held.';
export const ALREADY_PLANNED =
  'You already have a booked plan. Cancel it first if you want to plan something else, or ask for a single booking.';
export const ALREADY_BOOKED = 'Your plan is already booked.';
export const CANCELLED =
  'The whole plan is cancelled. I checked every booking with the server, and none of them is active any more.';

export function planned(plan: Itinerary): string {
  const found = plan.legs.filter((leg) => leg.status === 'selected');
  const missing = plan.legs.filter((leg) => leg.status === 'failed');
  const intro = found.length > 0 ? `Here’s your plan for ${formatDate(plan.date)}: ${listJoin(found.map(legLine))}. ` : '';
  if (missing.length === 0) return `${intro}Nothing is held yet. Shall I hold the whole plan?`;
  const gaps = missing
    .map((leg) => `I couldn’t find ${describeSearch(leg.search)}${leg.error ? ` (${leg.error.message})` : ''}.`)
    .join(' ');
  return `${intro}${gaps} Try that part again or change the request, and then I can hold the plan.`;
}

export function allHeld(plan: Itinerary): string {
  const first = earliestExpiry(plan);
  const until = first ? ` The first hold runs out at ${formatTime(new Date(first.at).toISOString())}.` : '';
  const count = every(plan.legs.length);
  return `${capitalize(count)} are held.${until} Shall I confirm ${count}? Nothing is booked until you say yes.`;
}

export function confirmed(plan: Itinerary): string {
  return `${capitalize(every(plan.legs.length))} are booked: ${listJoin(plan.legs.map(legLine))}.`;
}

/** After a failed hold, check or confirmation, once every release is verified. */
export function rolledBack(plan: Itinerary): string {
  const parts = [plan.notice ?? 'Something went wrong with the plan.'];
  const released = plan.legs.filter((leg) => leg.note === RELEASED_NOTE);
  if (released.length > 0) {
    parts.push(
      `I released ${listJoin(released.map(describeLeg))}, and the server confirmed ${released.length === 1 ? 'it is' : 'they are'} no longer held.`,
    );
  }
  // A hold that got no answer locks the plan, so there is nothing to pick or hold yet.
  const unknown = plan.legs.find((leg) => leg.mayBeHeld)?.mayBeHeld;
  if (unknown) return [...parts, unknownHold(unknown), 'Say “check again” to look sooner.'].join(' ');
  const failed = plan.legs.find((leg) => leg.status === 'failed');
  if (failed && failed.alternatives.length > 0) {
    const times = failed.alternatives.map((slot) => formatTime(slot.start_time));
    parts.push(`The closest I can offer is ${listJoin(times, 'or')}. Pick one in the plan, then hold the plan again.`);
  } else if (failed) {
    parts.push('Pick another option for it in the plan, then hold the plan again.');
  } else {
    parts.push('Shall I hold the plan again?');
  }
  return parts.join(' ');
}

export function cleanupFailed(plan: Itinerary): string {
  const legs = unresolvedLegs(plan);
  const one = legs.length === 1;
  const names = listJoin(legs.map((leg) => `${describeLeg(leg)} (${leg.booking?.booking_id ?? 'no ID'})`));
  return `I couldn’t confirm that ${names} ${one ? 'was' : 'were'} released, so ${one ? 'it' : 'they'} may still be active. Shall I retry the cleanup?`;
}

/** The reply to anything else while the plan waits for the guest. */
export function waiting(plan: Itinerary): string {
  if (plan.phase === 'cleanup_failed') return cleanupFailed(plan);
  const count = every(plan.legs.length);
  return `Your plan is on hold: say yes to confirm ${count}, or cancel the plan. I can’t start anything else until then.`;
}

export function notReady(plan: Itinerary): string {
  const missing = plan.legs.filter((leg) => leg.status !== 'selected').map(describeLeg);
  return `${capitalize(listJoin(missing))} still ${missing.length === 1 ? 'needs' : 'need'} an option. Pick one, try again, or change the request.`;
}

export function removed(leg: Leg, canHold: boolean): string {
  return `Okay, I took ${describeLeg(leg)} out of the plan.${canHold ? ' Shall I hold the whole plan?' : ''}`;
}

export function unsupported(reason: string): string {
  return `${reason} You can also ask for one booking at a time.`;
}

export function handoffReleased(name: string): string {
  return `I released your hold on ${name} first, so it doesn’t get in the way of the plan.`;
}

export function handoffFailed(name: string): string {
  return `I couldn’t release your hold on ${name}, so I didn’t start the plan. Confirm or release it first.`;
}
