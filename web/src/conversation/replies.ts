import type { Availability, BookingResult, Listing, SearchAvailabilityInput } from '../contract/types';
import { groupByPlace } from '../lib/places';
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

export function results(list: Availability[], input: SearchAvailabilityInput): string {
  if (list.length === 0) {
    return `I couldn’t find ${describeSearch(input)}. Try another time, another day, or fewer wishes.`;
  }
  const places = groupByPlace(list);
  const [best] = list;
  // "times" only when every option starts at a different time; rooms or services at one time are "options".
  const noun = new Set(list.map((slot) => slot.start_time)).size === list.length ? 'time' : 'option';
  const found =
    places.length === 1
      ? `I found ${list.length === 1 ? `one ${noun}` : `${list.length} ${noun}s`} at ${best.name}`
      : `I found ${list.length} options at ${places.length} places`;
  return `${found} for ${describeSearch(input)}. ${best.reason}, closest at ${formatTime(best.start_time)}. Shall I hold it?`;
}

/** A short spoken version of the details sheet. */
export function details(listing: Listing): string {
  const about = listing.description.charAt(0).toLowerCase() + listing.description.slice(1);
  const features = listing.features.length > 0 ? ` Features: ${listing.features.join(', ')}.` : '';
  const offers =
    listing.service_types.length > 0
      ? ` Services: ${listing.service_types.join(', ')}.`
      : listing.room_types.length > 0
        ? ` Rooms: ${listing.room_types.join(', ')}.`
        : '';
  return `${listing.name}: ${about}${features}${offers}`;
}

export function held(result: BookingResult): string {
  return `${result.summary} Shall I confirm it?`;
}

export function changed(result: BookingResult): string {
  return `Changed. ${result.summary}`;
}

export function expired(name: string): string {
  return `The hold on ${name} ran out before it was confirmed, so it was released. Want me to look for that time again?`;
}

export function conflict(message: string, alternatives: Availability[]): string {
  if (alternatives.length === 0) return `${message} I couldn’t find anything close, so try another time.`;
  const options = alternatives.map((result) => `${result.name} at ${formatTime(result.start_time)}`).join(' or ');
  return `${message} The closest I can offer is ${options}.`;
}

export function notFreeThen(name: string, time: string): string {
  return `${name} has no free slot at ${formatClockTime(time)}.`;
}

export function failed(message: string): string {
  return `Something went wrong: ${message}`;
}

export function noSuchOption(count: number): string {
  return count === 1 ? 'There is only one place on screen.' : `There are only ${count} places on screen.`;
}

export function noSuchTime(time: string): string {
  return `There’s no option at ${formatClockTime(time)} on screen.`;
}
