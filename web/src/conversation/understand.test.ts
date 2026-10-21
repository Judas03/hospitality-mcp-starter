import { describe, expect, it } from 'vitest';
import { completeSearch, parseDate, parsePartySize, parseTime, understand, type Situation } from './understand';

// Wednesday 21 October 2026, 10:00 in Bangkok.
const NOW = new Date('2026-10-21T03:00:00Z');
const idle: Situation = { now: NOW, resultNames: [], hasHold: false, hasBooking: false };

describe('understand: the demo requests', () => {
  it('reads the main demo sentence', () => {
    expect(understand('Find a quiet restaurant for two tomorrow at 7 PM', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'restaurant', date: '2026-10-22', time: '19:00', party_size: 2, preferences: ['quiet'] },
    });
  });

  it('reads a weekday, a 24-hour time and a wish', () => {
    expect(understand('Table for 4 on Saturday at 12:30 with outdoor seating', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'restaurant', date: '2026-10-24', time: '12:30', party_size: 4, preferences: ['outdoor'] },
    });
  });

  it('reads salon services', () => {
    expect(understand('Book a haircut for one tomorrow at 3 PM', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'salon', date: '2026-10-22', time: '15:00', party_size: 1, service_type: 'haircut' },
    });
    expect(understand('Manicure on Friday at 11 AM', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'salon', date: '2026-10-23', time: '11:00', service_type: 'manicure' },
    });
  });

  it('reads hotel rooms and wishes', () => {
    expect(understand('Double room for two this Friday', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'hotel', date: '2026-10-23', party_size: 2, room_type: 'double' },
    });
    expect(understand('Hotel with a pool for 2 tomorrow', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'hotel', date: '2026-10-22', party_size: 2, preferences: ['pool'] },
    });
  });
});

describe('understand: parts', () => {
  it('reads times', () => {
    expect(parseTime('at 7.30pm')).toBe('19:30');
    expect(parseTime('at 7')).toBe('19:00');
    expect(parseTime('around noon')).toBe('12:00');
    expect(parseTime('12 am')).toBe('00:00');
    expect(parseTime('for 2 people')).toBeNull();
  });

  it('does not take times or nights for a party size', () => {
    expect(parsePartySize('for 2 nights')).toBeNull();
    expect(parsePartySize('for 7 pm')).toBeNull();
    expect(parsePartySize('a party of six')).toBe(6);
    expect(parsePartySize('just me')).toBe(1);
  });

  it('reads dates, rolling past ones into next year', () => {
    expect(parseDate('on 23 October', NOW)).toBe('2026-10-23');
    expect(parseDate('Oct 5', NOW)).toBe('2027-10-05');
    expect(parseDate('on 1/11', NOW)).toBe('2026-11-01');
    expect(parseDate('friday', NOW)).toBe('2026-10-23');
    expect(parseDate('wednesday', NOW)).toBe('2026-10-28');
    expect(parseDate('31 February', NOW)).toBeNull();
  });
});

describe('understand: the conversation around a booking', () => {
  const results: Situation = { ...idle, resultNames: ['Baan Suan Garden Kitchen', 'Silom Quiet Room'] };
  const holding: Situation = { ...idle, hasHold: true };
  const booked: Situation = { ...idle, hasBooking: true };

  it('picks a result by position or by name', () => {
    expect(understand('Hold the first one', results)).toEqual({ kind: 'choose', index: 0 });
    expect(understand('Tell me more about the second one', results)).toEqual({ kind: 'details', index: 1 });
    expect(understand('Silom please', results)).toEqual({ kind: 'choose', index: 1 });
  });

  it('takes a plain yes after results as the best match', () => {
    expect(understand('yes', results)).toEqual({ kind: 'choose', index: 0 });
  });

  it('takes a yes after an expired hold as "search again"', () => {
    expect(understand('Yes, look for that time again', { ...idle, holdExpired: true })).toEqual({ kind: 'search_again' });
    expect(understand('yes', idle)).toEqual({ kind: 'unknown' });
  });

  it('only confirms when the guest says so', () => {
    expect(understand('Yes, confirm it', holding)).toEqual({ kind: 'confirm' });
    expect(understand('No, release it', holding)).toEqual({ kind: 'decline' });
    expect(understand('ok find me a hotel instead', idle).kind).toBe('search');
  });

  it('changes and cancels a confirmed booking', () => {
    expect(understand('Move it to 8:00 PM', booked)).toEqual({ kind: 'modify', time: '20:00' });
    expect(understand('Make it 3 people', booked)).toEqual({ kind: 'modify', partySize: 3 });
    expect(understand('Make it 3', booked)).toEqual({ kind: 'modify', partySize: 3 });
    expect(understand('Cancel my booking', booked)).toEqual({ kind: 'cancel' });
  });
});

describe('completeSearch', () => {
  it('fills only what was not said, and lists it as assumed', () => {
    const { input, assumed } = completeSearch(
      { provider_type: 'restaurant', date: '2026-10-22', time: '19:00', party_size: 2, preferences: ['quiet'] },
      'restaurant',
      NOW,
    );
    expect(input).toEqual({
      provider_type: 'restaurant',
      location: 'Bangkok',
      date: '2026-10-22',
      time: '19:00',
      party_size: 2,
      service_type: null,
      room_type: null,
      preferences: ['quiet'],
    });
    expect(assumed).toEqual(['location']);
  });

  it('moves an assumed date to tomorrow when the default time has passed', () => {
    const lateEvening = new Date('2026-10-21T15:00:00Z'); // 22:00 in Bangkok
    const { input, assumed } = completeSearch({}, 'restaurant', lateEvening);
    expect(input.date).toBe('2026-10-22');
    expect(input.time).toBe('19:00');
    expect(assumed).toEqual(['time', 'date', 'location', 'party_size']);
  });

  it('never sends a service or room type for the wrong kind of place', () => {
    const { input } = completeSearch({ provider_type: 'restaurant', service_type: 'haircut' }, 'salon', NOW);
    expect(input.service_type).toBeNull();
  });
});
