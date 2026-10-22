import type { ToolError } from '../mcp/types';
import type { Leg } from './types';

// What the concierge says. Notices explain the last failure on the panel; chat replies follow.

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

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
