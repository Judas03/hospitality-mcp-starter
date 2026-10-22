import { describe, expect, it } from 'vitest';
import type { SearchAvailabilityInput } from '../contract/types';
import { SEED_PROMPTS } from '../conversation/suggestions';
import { MAIN_SCRIPT } from '../demo/script';
import { ONE_PER_CATEGORY, parseItinerary } from './parseItinerary';
import type { ParsedItinerary } from './types';

// Thursday 22 October 2026, 14:00 in Bangkok.
const NOW = new Date('2026-10-22T07:00:00Z');
const EXAMPLE =
  'Plan my anniversary tomorrow in Bangkok: a manicure for me at 3 PM, a quiet dinner for two at 7 PM, and a river-view hotel for two.';

const search = (fields: Partial<SearchAvailabilityInput>): SearchAvailabilityInput => ({
  provider_type: 'restaurant',
  location: 'Bangkok',
  date: '2026-10-23',
  time: '19:00',
  party_size: 2,
  service_type: null,
  room_type: null,
  preferences: [],
  ...fields,
});

const MANICURE = search({ provider_type: 'salon', time: '15:00', party_size: 1, service_type: 'manicure' });
const QUIET_DINNER = search({ preferences: ['quiet'] });
const RIVER_HOTEL = search({ provider_type: 'hotel', time: '15:00', preferences: ['river view'] });

function plan(text: string, now = NOW) {
  const parsed = parseItinerary(text, now);
  if (parsed?.kind !== 'plan') throw new Error(`not a plan: ${JSON.stringify(parsed)}`);
  return parsed;
}
const providers = (parsed: ParsedItinerary & { kind: 'plan' }) => parsed.legs.map((leg) => leg.search.provider_type);

describe('parseItinerary: the issue’s example', () => {
  it('makes three legs with the backend tests’ exact searches', () => {
    expect(parseItinerary(EXAMPLE, NOW)).toEqual({
      kind: 'plan',
      date: '2026-10-23',
      legs: [
        { search: MANICURE, assumed: [] },
        { search: QUIET_DINNER, assumed: [] },
        { search: RIVER_HOTEL, assumed: ['time'] },
      ],
    });
  });

  it('reads the same request without a colon, with "and" between the parts', () => {
    const parsed = plan(
      'Plan my anniversary tomorrow in Bangkok and a manicure for me at 3 PM, a quiet dinner for two at 7 PM and a river view hotel for two',
    );
    expect(parsed.legs.map((leg) => leg.search)).toEqual([MANICURE, QUIET_DINNER, RIVER_HOTEL]);
  });

  it('keeps the order the guest named the parts in, and shares a date named in one part', () => {
    const parsed = plan('A river-view hotel for two, dinner for two at 7 PM and a manicure at 3 PM tomorrow');
    expect(providers(parsed)).toEqual(['hotel', 'restaurant', 'salon']);
    expect(parsed.legs.map((leg) => leg.search.date)).toEqual(['2026-10-23', '2026-10-23', '2026-10-23']);
    expect(parsed.legs[2]).toEqual({ search: MANICURE, assumed: ['location', 'party_size'] });
  });

  it('does not take a colon inside a time as the end of a header', () => {
    const parsed = plan('Dinner at 7:30 PM and a hotel room tomorrow');
    expect(parsed.legs.map((leg) => [leg.search.provider_type, leg.search.time])).toEqual([
      ['restaurant', '19:30'],
      ['hotel', '15:00'],
    ]);
  });
});

describe('parseItinerary: what the parts share', () => {
  it('assumes today when every part is at least half an hour away, otherwise tomorrow, for all parts', () => {
    const today = plan('A haircut at 3 PM and dinner at 7 PM');
    expect(today.date).toBe('2026-10-22');
    expect(today.legs.every((leg) => leg.search.date === '2026-10-22' && leg.assumed.includes('date'))).toBe(true);

    // 18:45: the 7 PM haircut is too close, so neither part is booked today.
    const late = plan('A haircut at 7 PM and dinner at 8 PM', new Date('2026-10-22T11:45:00Z'));
    expect(late.legs.map((leg) => leg.search.date)).toEqual(['2026-10-23', '2026-10-23']);
  });

  it('uses a party size in the header for the table and the room, not the salon visit', () => {
    const parsed = plan('Plan a night out for two: a haircut at 1 PM, dinner at 7 PM and a hotel room');
    expect(parsed.legs.map((leg) => [leg.search.provider_type, leg.search.party_size, leg.assumed.includes('party_size')])).toEqual([
      ['salon', 1, true],
      ['restaurant', 2, false],
      ['hotel', 2, false],
    ]);
  });

  it('does not share wishes from the header, which would empty every search', () => {
    const parsed = plan('Plan a romantic evening tomorrow: dinner at 7 PM and a hotel room');
    expect(parsed.legs.map((leg) => leg.search.preferences)).toEqual([[], []]);
  });

  it('adds a part that names no category to the part before it', () => {
    const parsed = plan('Tomorrow: a quiet dinner for two at 7 PM, outside, and a hotel room for two');
    expect(parsed.legs[0].search.preferences).toEqual(['quiet', 'outdoor seating']);
    expect(parsed.legs[1].search.preferences).toEqual([]);
  });
});

describe('parseItinerary: what it leaves alone or refuses', () => {
  it('leaves every suggestion and scripted line to the single-booking flow', () => {
    const lines = [...Object.values(SEED_PROMPTS).flat(), ...MAIN_SCRIPT.map((line) => line.say)];
    expect(lines.filter((line) => parseItinerary(line, NOW) !== null)).toEqual([]);
  });

  it('counts parts, not words, so one request that mentions two categories stays a single booking', () => {
    for (const text of [
      'a table at the hotel restaurant for two at 7:30 PM',
      'Hotel room with a river view for 2 tomorrow',
      'Table for 4, outdoors and quiet',
      'help',
    ]) {
      expect(parseItinerary(text, NOW)).toBeNull();
    }
  });

  it('refuses two parts in one category', () => {
    expect(parseItinerary('A haircut at 1 PM, a manicure at 3 PM and dinner at 7 PM', NOW)).toEqual({
      kind: 'unsupported',
      reason: ONE_PER_CATEGORY,
    });
  });

  it('refuses parts on different days instead of splitting the plan', () => {
    expect(parseItinerary('Tomorrow: a haircut at 1 PM and dinner on Saturday at 7 PM', NOW)).toEqual({
      kind: 'unsupported',
      reason: 'This plan names more than one day (Fri 23 Oct and Sat 24 Oct). I can plan one day at a time, so ask for each day separately.',
    });
    expect(plan('Tomorrow: a haircut tomorrow at 1 PM and dinner at 7 PM').date).toBe('2026-10-23');
  });
});
