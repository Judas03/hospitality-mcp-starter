import type { ProviderType } from '../contract/types';
import type { FlowState } from '../booking/flow';
import { addMinutes, formatTime } from '../lib/time';

/** Ready-made requests for the demo, so the recording never depends on typing. */
export const SEED_PROMPTS: Record<ProviderType, string[]> = {
  restaurant: ['Find a quiet restaurant for two tomorrow at 7 PM', 'Table for 4 on Saturday at 12:30 with outdoor seating'],
  salon: ['Book a haircut for one tomorrow at 3 PM', 'Manicure on Friday at 11 AM'],
  hotel: ['Double room for two this Friday', 'Hotel with a pool for 2 tomorrow'],
};

/** Suggestion chips for what the guest is most likely to say next. */
export function suggestionsFor(state: FlowState): string[] {
  if (state.busy) return [];
  const { booking } = state;
  if (state.view === 'held' && booking) {
    return booking.record.status === 'held'
      ? ['Yes, confirm it', 'No, release it']
      : ['Yes, look for that time again', SEED_PROMPTS[state.provider][0]];
  }
  if (state.view === 'confirmed' && booking) {
    return [
      `Move it to ${formatTime(addMinutes(booking.slot.start_time, 60))}`,
      `Make it ${booking.partySize + 1} people`,
      'Cancel my booking',
    ];
  }
  if (state.view === 'results' && state.results.length > 0) {
    const chips = ['Hold the first one'];
    if (state.results.length > 1) chips.push('Tell me more about the second one');
    return [...chips, SEED_PROMPTS[state.provider][1]];
  }
  return SEED_PROMPTS[state.provider];
}
