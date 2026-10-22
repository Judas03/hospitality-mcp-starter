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

  it('reads a weekday, a 24-hour time and a wish, in the backend’s feature names', () => {
    expect(understand('Table for 4 on Saturday at 19:30 with outdoor seating', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'restaurant', date: '2026-10-24', time: '19:30', party_size: 4, preferences: ['outdoor seating'] },
    });
    expect(understand('Table for 4 by the river on Saturday at 7:30 PM', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'restaurant', date: '2026-10-24', time: '19:30', party_size: 4, preferences: ['river view'] },
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

  it('reads hotel room types, and treats bed words as any room', () => {
    expect(understand('Suite for 4 this Friday', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'hotel', date: '2026-10-23', party_size: 4, room_type: 'suite' },
    });
    expect(understand('Double room for two this Friday', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'hotel', date: '2026-10-23', party_size: 2 },
    });
    expect(understand('Hotel room with a river view for 2 tomorrow', idle)).toEqual({
      kind: 'search',
      fields: { provider_type: 'hotel', date: '2026-10-22', party_size: 2, preferences: ['river view'] },
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
  const results: Situation = { ...idle, resultNames: ['Siam Serenity', 'Riverside Social'] };
  const onePlace: Situation = { ...idle, resultNames: ['Siam Serenity'] };
  const holding: Situation = { ...idle, hasHold: true };
  const booked: Situation = { ...idle, hasBooking: true };

  it('picks a place by position or by name', () => {
    expect(understand('Hold the first one', results)).toEqual({ kind: 'choose', index: 0 });
    expect(understand('Tell me more about the second one', results)).toEqual({ kind: 'details', index: 1 });
    expect(understand('Riverside please', results)).toEqual({ kind: 'choose', index: 1 });
  });

  it('picks a time, with or without a place', () => {
    expect(understand('Hold the 7:30 PM one', results)).toEqual({ kind: 'choose', index: null, time: '19:30' });
    expect(understand('Hold the first one at 6:30 pm', results)).toEqual({ kind: 'choose', index: 0, time: '18:30' });
  });

  it('reads "it" as the only place on screen', () => {
    expect(understand('Tell me more about it', onePlace)).toEqual({ kind: 'details', index: 0 });
    expect(understand('Tell me more', onePlace)).toEqual({ kind: 'details', index: 0 });
    expect(understand("What's it like?", onePlace)).toEqual({ kind: 'details', index: 0 });
  });

  it('does not open the only place for a question about something else', () => {
    expect(understand("what's the weather like", onePlace)).toEqual({ kind: 'unknown' });
    expect(understand('what is the time', onePlace)).toEqual({ kind: 'unknown' });
  });

  it('treats a request for something else as a new search, not a pick', () => {
    const tables: Situation = { ...idle, resultNames: ['Riverside Social'], resultsProvider: 'restaurant' };
    expect(understand('Book a haircut for one tomorrow at 1 PM', tables)).toEqual({
      kind: 'search',
      fields: { provider_type: 'salon', date: '2026-10-22', time: '13:00', party_size: 1, service_type: 'haircut' },
    });
    expect(understand('Book a table for two tomorrow at 8 PM', tables).kind).toBe('search');
    expect(understand('Hold the 7:30 PM one', tables)).toEqual({ kind: 'choose', index: null, time: '19:30' });
    // A bare 7:30 reads as 07:30; picking it among evening options is findSlotAt's job.
    expect(understand('Hold the 7:30 table', tables)).toEqual({ kind: 'choose', index: null, time: '07:30' });
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

  it('assumes times inside the backend’s opening hours', () => {
    expect(completeSearch({ provider_type: 'salon' }, 'restaurant', NOW).input.time).toBe('13:00');
    expect(completeSearch({ provider_type: 'hotel' }, 'restaurant', NOW).input.time).toBe('15:00');
  });

  it('never sends a service or room type for the wrong kind of place', () => {
    const { input } = completeSearch({ provider_type: 'restaurant', service_type: 'haircut' }, 'salon', NOW);
    expect(input.service_type).toBeNull();
  });
});
