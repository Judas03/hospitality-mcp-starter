import type { Booking, SearchAvailabilityInput, SearchResult } from '../contract/types';
import { formatClockTime, formatDate, formatTime } from '../lib/time';

export const GREETING =
  'Hi! I can find and book restaurant tables, salon appointments and hotel rooms in Bangkok. Pick a suggestion below or tell me what you need.';
export const HELP =
  'Tell me what you need, for example “Find a quiet restaurant for two tomorrow at 7 PM”. I’ll show options with reasons, hold the one you pick, and only book it once you say yes. After that you can change or cancel it.';
export const UNKNOWN =
  'Sorry, I didn’t catch that. You can ask for a table, a salon appointment or a hotel room, or pick a suggestion below.';
export const BUSY = 'One moment, I’m still working on your last request.';
export const NOTHING_TO_CONFIRM = 'There’s nothing waiting for confirmation yet. Pick an option and I’ll hold it first.';
export const ALREADY_CONFIRMED = 'That booking is already confirmed.';
export const NO_BOOKING = 'You don’t have a booking to change yet.';
export const NO_CHANGE = 'That’s already how the booking is.';
export const RELEASED = 'Okay, I let the hold go. Pick another option or ask for something else.';

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

export function describeSearch(input: SearchAvailabilityInput): string {
  const what =
    input.provider_type === 'salon'
      ? input.service_type
        ? `a ${input.service_type}`
        : 'a salon appointment'
      : input.provider_type === 'hotel'
        ? `${input.room_type ? `a ${input.room_type}` : 'a hotel'} room`
        : 'a table';
  const wishes = input.preferences.length > 0 ? ` (${input.preferences.join(', ')})` : '';
  return `${what} for ${input.party_size}${wishes} in ${input.location}, ${formatDate(input.date)} at ${formatClockTime(input.time)}`;
}

export function results(list: SearchResult[], input: SearchAvailabilityInput): string {
  if (list.length === 0) {
    return `I couldn’t find ${describeSearch(input)}. Try another time, another day, or fewer wishes.`;
  }
  const [best] = list;
  const count = list.length === 1 ? 'one option' : `${list.length} options`;
  return `I found ${count} for ${describeSearch(input)}. The best match is ${best.name} at ${formatTime(best.start_time)}: ${lowerFirst(best.reason)}. Shall I hold it?`;
}

export function held(record: Booking, slot: SearchResult): string {
  const until = record.expires_at ? ` until ${formatTime(record.expires_at)}` : '';
  return `${slot.name} is on hold for you${until}. Shall I confirm it?`;
}

export function expired(slot: SearchResult): string {
  return `The hold on ${slot.name} ran out before it was confirmed, so it was released. Want me to look for that time again?`;
}

export function conflict(message: string, alternatives: SearchResult[]): string {
  if (alternatives.length === 0) return `${message} I couldn’t find anything close, so try another time.`;
  const options = alternatives.map((result) => `${result.name} at ${formatTime(result.start_time)}`).join(' or ');
  return `${message} The closest I can offer is ${options}.`;
}

export function failed(message: string): string {
  return `Something went wrong: ${message}`;
}

export function noSuchOption(count: number): string {
  return count === 1 ? 'There is only one option on screen.' : `There are only ${count} options on screen.`;
}
