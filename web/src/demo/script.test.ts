import { describe, expect, it } from 'vitest';
import type { Availability } from '../contract/types';
import { understand, type Situation } from '../conversation/understand';
import { bestOption, MAIN_SCRIPT } from './script';

// Wednesday 21 October 2026, 10:00 in Bangkok.
const NOW = new Date('2026-10-21T03:00:00Z');
const idle: Situation = { now: NOW, resultNames: [], hasHold: false, hasBooking: false };

/** Where the page is when each line is played, in order. */
const SITUATIONS: Situation[] = [
  idle,
  { ...idle, resultNames: ['Siam Serenity'] },
  { ...idle, resultNames: ['Siam Serenity'] }, // the server's alternatives after the conflict
  { ...idle, hasHold: true },
  { ...idle, hasBooking: true },
  { ...idle, hasBooking: true },
  { ...idle, hasBooking: true },
];

describe('the scripted demo', () => {
  it('has one situation per line', () => {
    expect(SITUATIONS).toHaveLength(MAIN_SCRIPT.length);
  });

  it('is read as intended at every step, so a recording never goes off script', () => {
    const intents = MAIN_SCRIPT.map((line, index) => understand(line.say, SITUATIONS[index]));
    expect(intents).toEqual([
      {
        kind: 'search',
        fields: { provider_type: 'restaurant', date: '2026-10-22', time: '19:00', party_size: 2, preferences: ['quiet'] },
      },
      { kind: 'choose', index: 0 },
      { kind: 'choose', index: null, time: '19:30' },
      { kind: 'confirm' },
      { kind: 'modify', time: '20:00' },
      { kind: 'modify', partySize: 3 },
      { kind: 'cancel' },
    ]);
  });

  it('lets the other guest act only on the line that holds the best option', () => {
    expect(MAIN_SCRIPT.filter((line) => line.rivalTakesBest).map((line) => line.say)).toEqual(['Hold the first one']);
  });

  it('targets the option "Hold the first one" picks', () => {
    const slot = (listing_id: string, time: string) =>
      ({ listing_id, name: listing_id, availability_id: `${listing_id}_${time}`, start_time: time }) as Availability;
    const results = [slot('rest_001', '19:00'), slot('rest_002', '19:00'), slot('rest_001', '18:30')];
    expect(bestOption(results)?.availability_id).toBe('rest_001_19:00');
    expect(bestOption([])).toBeNull();
  });
});
