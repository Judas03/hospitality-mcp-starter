import type { ProviderType } from '../contract/types';
import type { FlowState } from '../booking/flow';
import { groupByPlace } from '../lib/places';
import { addDays, addMinutes, formatDate, formatTime, splitIso } from '../lib/time';

/** Ready-made requests for the demo that find options in the backend's inventory. */
export const SEED_PROMPTS: Record<ProviderType, string[]> = {
  restaurant: ['Find a quiet restaurant for two tomorrow at 7 PM', 'Table for 4 by the river on Saturday at 7:30 PM'],
  salon: ['Book a haircut for one tomorrow at 1 PM', 'Manicure on Friday at 11 AM'],
  hotel: ['Hotel room with a river view for 2 tomorrow', 'Suite for 4 this Friday'],
};

/** The Occasion Concierge's example: three bookings from one request. */
export const PLAN_PROMPT =
  'Plan my anniversary tomorrow: a manicure for me at 3 PM, a quiet dinner for two at 7 PM and a river-view hotel for two';

/** Suggestion chips for what the guest is most likely to say next. */
export function suggestionsFor(state: FlowState): string[] {
  if (state.busy) return [];
  const { current } = state;
  if (state.view === 'held' && current) {
    return current.booking.status === 'held'
      ? ['Yes, confirm it', 'No, release it']
      : ['Yes, look for that time again', SEED_PROMPTS[state.provider][0]];
  }
  if (state.view === 'confirmed' && current) {
    const { booking } = current;
    if (booking.provider_type === 'restaurant') {
      return [
        `Move it to ${formatTime(addMinutes(booking.start_time, 30))}`,
        `Make it ${booking.party_size + 1} people`,
        'Cancel my booking',
      ];
    }
    const nextDay = addDays(splitIso(booking.start_time).date, 1);
    return [`Move it to ${formatDate(nextDay).split(' ').slice(1).join(' ')}`, 'Cancel my booking'];
  }
  if (state.view === 'results' && state.results.length > 0) {
    const places = groupByPlace(state.results);
    const chips = ['Hold the first one'];
    const second = places[0].slots[1];
    if (second) chips.push(`Hold the ${formatTime(second.start_time)} one`);
    chips.push(places.length > 1 ? 'Tell me more about the second one' : 'Tell me more about it');
    return chips;
  }
  return [...SEED_PROMPTS[state.provider], PLAN_PROMPT];
}
