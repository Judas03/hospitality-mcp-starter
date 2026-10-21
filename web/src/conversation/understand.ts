import type { ProviderType, SearchAvailabilityInput } from '../contract/types';
import { addDays, bangkokDate, splitIso, toBangkokIso, weekdayOf } from '../lib/time';

// Rule-based reading of typed requests. It only ever fills the contract's own search fields,
// and the page shows which ones were assumed so the guest can correct them.

export type SearchFields = Partial<SearchAvailabilityInput>;

export type Intent =
  | { kind: 'search'; fields: SearchFields }
  /** A place by position or name, a start time, or both. */
  | { kind: 'choose'; index: number | null; time?: string }
  | { kind: 'details'; index: number }
  | { kind: 'confirm' }
  | { kind: 'decline' }
  | { kind: 'modify'; date?: string; time?: string; partySize?: number }
  | { kind: 'cancel' }
  | { kind: 'search_again' }
  | { kind: 'help' }
  | { kind: 'unknown' };

export interface Situation {
  now: Date;
  /** Names of the places on screen, in order. */
  resultNames: string[];
  /** A hold is waiting for a yes or no. */
  hasHold: boolean;
  /** A booking is confirmed. */
  hasBooking: boolean;
  /** A hold just ran out and the assistant offered to look for that time again. */
  holdExpired?: boolean;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
const NUM = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const toNumber = (word: string) => (/^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word]);
const pad = (n: number) => String(n).padStart(2, '0');

const PARTY_PATTERNS = [
  new RegExp(`\\b(?:party|group|table) of ${NUM}\\b`),
  new RegExp(`\\b${NUM} (?:people|persons|guests|adults|of us|pax)\\b`),
  new RegExp(`\\btable for ${NUM}\\b`),
  new RegExp(
    `\\bfor ${NUM}\\b(?!\\s*(?::|\\.\\d|am\\b|pm\\b|a\\.m|p\\.m|o'?clock|nights?\\b|hours?\\b|minutes?\\b|days?\\b|weeks?\\b))`,
  ),
];

export function parsePartySize(text: string): number | null {
  const t = text.toLowerCase();
  if (/\b(just me|for me|myself|for one person)\b/.test(t)) return 1;
  if (/\b(a couple|the two of us|both of us)\b/.test(t)) return 2;
  for (const pattern of PARTY_PATTERNS) {
    const match = t.match(pattern);
    if (match) return toNumber(match[1]);
  }
  return null;
}

export function parseTime(text: string): string | null {
  const t = text.toLowerCase();
  let match = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/);
  if (match && Number(match[1]) >= 1 && Number(match[1]) <= 12) {
    const hour = (Number(match[1]) % 12) + (match[3].startsWith('p') ? 12 : 0);
    return `${pad(hour)}:${pad(Number(match[2] ?? 0))}`;
  }
  match = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (match) return `${pad(Number(match[1]))}:${match[2]}`;
  if (/\b(noon|midday)\b/.test(t)) return '12:00';
  match = t.match(/\bat (\d{1,2})(?:\s*o'?clock)?\b(?!\s*(?:people|persons|guests|nights?)\b)/);
  if (match) {
    let hour = Number(match[1]);
    if (hour >= 1 && hour <= 7) hour += 12; // "at 7" means the evening, not 7 in the morning
    if (hour <= 23) return `${pad(hour)}:00`;
  }
  if (/\bdinner\b/.test(t)) return '19:00';
  if (/\blunch\b/.test(t)) return '12:00';
  return null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH = `(${MONTHS.join('|')})[a-z]*`;

function makeDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** A day and month without a year: this year, or next year if it has already passed. */
function upcoming(today: string, month: number, day: number): string | null {
  const year = Number(today.slice(0, 4));
  const date = makeDate(year, month, day);
  return date && date < today ? makeDate(year + 1, month, day) : date;
}

export function parseDate(text: string, now: Date): string | null {
  const t = text.toLowerCase();
  const today = bangkokDate(now);
  if (/\bday after tomorrow\b/.test(t)) return addDays(today, 2);
  if (/\btomorrow\b/.test(t)) return addDays(today, 1);
  if (/\b(today|tonight|this evening)\b/.test(t)) return today;

  let match = t.match(new RegExp(`\\b(?:(this|next|on)\\s+)?(${WEEKDAYS.join('|')})\\b`));
  if (match) {
    const diff = (WEEKDAYS.indexOf(match[2]) - weekdayOf(today) + 7) % 7;
    return addDays(today, diff === 0 && match[1] !== 'this' ? 7 : diff);
  }
  match = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (match) return makeDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b`));
  if (match) return upcoming(today, MONTHS.indexOf(match[2]) + 1, Number(match[1]));
  match = t.match(new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (match) return upcoming(today, MONTHS.indexOf(match[1]) + 1, Number(match[2]));
  match = t.match(/\b(\d{1,2})\/(\d{1,2})\b/); // day/month, as written in Thailand
  if (match) return upcoming(today, Number(match[2]), Number(match[1]));
  return null;
}

export function parseProvider(text: string): ProviderType | null {
  const t = text.toLowerCase();
  const named = t.match(/\b(restaurant|salon|barber|spa|hotel)\b/);
  if (named) return named[1] === 'restaurant' ? 'restaurant' : named[1] === 'hotel' ? 'hotel' : 'salon';
  if (/\b(hair ?cut|hair|nails?|manicure|pedicure|massage|facial|beard|blow ?dry)\b/.test(t)) return 'salon';
  if (/\b(room|stay|nights?|suite|check[- ]?in)\b/.test(t)) return 'hotel';
  if (/\b(table|dinner|lunch|brunch|eat|dine|dining)\b/.test(t)) return 'restaurant';
  return null;
}

const CITIES = ['Bangkok', 'Chiang Mai', 'Chiang Rai', 'Phuket', 'Pattaya', 'Krabi', 'Hua Hin', 'Ayutthaya', 'Khon Kaen'];
const NOT_PLACES = new Set([...WEEKDAYS, ...MONTHS].map((word) => word.slice(0, 3)));

export function parseLocation(text: string): string | null {
  const city = CITIES.find((name) => text.toLowerCase().includes(name.toLowerCase()));
  if (city) return city;
  const match = text.match(/\b(?:in|near|around)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/);
  if (match && !NOT_PLACES.has(match[1].slice(0, 3).toLowerCase())) return match[1];
  return null;
}

// Wish words -> the feature names the backend's listings use. Every wish must match a feature,
// so wishes outside this list are still sent and simply find nothing.
const PREFERENCES: Array<[RegExp, string]> = [
  [/\b(quiet|peaceful|calm)\b/, 'quiet'],
  [/\b(outdoors?|outside|terrace|al fresco)\b/, 'outdoor seating'],
  [/\b(indoors?|inside)\b/, 'indoor seating'],
  [/\b(river ?view|riverside|by the river|on the river)\b/, 'river view'],
  [/\bthai (food|cuisine)\b/, 'thai cuisine'],
  [/\b(lively|buzzy)\b/, 'lively'],
  [/\b(accessible|wheelchair)\b/, 'accessible'],
  [/\bmodern\b/, 'modern'],
  [/\b(near (the )?(transit|bts|mrt|skytrain|station))\b/, 'near transit'],
  [/\bbreakfast\b/, 'breakfast'],
  [/\b(historic|old town)\b/, 'historic district'],
  [/\bgarden\b/, 'garden'],
  [/\bromantic\b/, 'romantic'],
  [/\bpool\b/, 'pool'],
];

export function parsePreferences(text: string): string[] {
  const t = text.toLowerCase();
  return PREFERENCES.filter(([pattern]) => pattern.test(t)).map(([, preference]) => preference);
}

const SERVICES: Array<[RegExp, string]> = [
  [/\bbeard\b/, 'beard trim'],
  [/\bblow ?dry\b/, 'blow dry'],
  [/\b(colou?r|dye|highlights)\b/, 'hair colour'],
  [/\b(hair ?cut|trim|cut my hair)\b/, 'haircut'],
  [/\bmanicure|\bnails?\b/, 'manicure'],
  [/\bpedicure\b/, 'pedicure'],
  [/\bmassage\b/, 'massage'],
  [/\bfacial\b/, 'facial'],
];

export function parseService(text: string): string | null {
  const t = text.toLowerCase();
  return SERVICES.find(([pattern]) => pattern.test(t))?.[1] ?? null;
}

/** The backend's room types. Bed words like "double" mean any room, so they set nothing. */
export function parseRoom(text: string): string | null {
  return text.toLowerCase().match(/\b(standard|deluxe|suite)\b/)?.[1] ?? null;
}

const ORDINALS: Array<[RegExp, number]> = [
  [/\b(first|1st|number one|option 1|#1)\b/, 0],
  [/\b(second|2nd|number two|option 2|#2)\b/, 1],
  [/\b(third|3rd|number three|option 3|#3)\b/, 2],
];
// Name words that are also everyday request words ("a quiet garden") don't pick a result by name.
const GENERIC_NAME_WORDS = new Set([
  'kitchen',
  'house',
  'room',
  'hotel',
  'club',
  'studio',
  'stay',
  'bangkok',
  'quiet',
  'garden',
  'terrace',
  'residence',
  'boutique',
]);

/** Which on-screen result the text points at, by position or by name. */
export function pickResult(text: string, names: string[]): number | null {
  const t = text.toLowerCase();
  if (names.length === 0) return null;
  for (const [pattern, index] of ORDINALS) if (pattern.test(t) && index < names.length) return index;
  if (/\b(last|final)\b/.test(t)) return names.length - 1;
  const byName = names.findIndex((name) =>
    name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((word) => word.length > 3 && !GENERIC_NAME_WORDS.has(word) && t.includes(word)),
  );
  return byName >= 0 ? byName : null;
}

function searchFields(text: string, now: Date): SearchFields {
  const fields: SearchFields = {};
  const provider = parseProvider(text);
  const location = parseLocation(text);
  const date = parseDate(text, now);
  const time = parseTime(text);
  const party = parsePartySize(text);
  const preferences = parsePreferences(text);
  const service = parseService(text);
  const room = parseRoom(text);
  if (provider) fields.provider_type = provider;
  if (location) fields.location = location;
  if (date) fields.date = date;
  if (time) fields.time = time;
  if (party) fields.party_size = party;
  if (preferences.length > 0) fields.preferences = preferences;
  if (service && provider !== 'restaurant' && provider !== 'hotel') fields.service_type = service;
  if (room && provider === 'hotel') fields.room_type = room;
  return fields;
}

export function understand(text: string, situation: Situation): Intent {
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return { kind: 'unknown' };
  if (/^(help|what can you do|how does this work)\b/.test(t)) return { kind: 'help' };

  const yes = /^(yes|yeah|yep|yup|sure|ok|okay|please do|book it|do it|go ahead|sounds good|perfect)\b/.test(t);
  if (((yes && situation.hasHold) || /\bconfirm\b/.test(t)) && !/\bcancel\b/.test(t)) return { kind: 'confirm' };
  // After "Shall I hold it?", a plain yes means the best match.
  if (yes && !situation.hasHold && situation.resultNames.length > 0) return { kind: 'choose', index: 0 };
  // After "Want me to look for that time again?", a plain yes searches again.
  if (yes && situation.holdExpired) return { kind: 'search_again' };
  if (situation.hasHold && (/^(no|nope|nah|not now|never ?mind)\b/.test(t) || /\b(release|let it go)\b/.test(t))) {
    return { kind: 'decline' };
  }
  if (/\bcancel\b/.test(t) && (situation.hasBooking || situation.hasHold)) {
    return situation.hasBooking ? { kind: 'cancel' } : { kind: 'decline' };
  }
  if ((situation.hasBooking || situation.hasHold) && /\b(move|change|reschedule|make it|switch|push|instead)\b/.test(t)) {
    const date = parseDate(t, situation.now) ?? undefined;
    const time = parseTime(t) ?? undefined;
    const makeIt = t.match(new RegExp(`\\bmake it ${NUM}\\b(?!\\s*(?::|am\\b|pm\\b|a\\.m|p\\.m))`));
    const partySize = parsePartySize(t) ?? (makeIt ? toNumber(makeIt[1]) : undefined);
    if (date || time || partySize) return { kind: 'modify', date, time, partySize };
  }

  if (situation.resultNames.length > 0) {
    const index = pickResult(t, situation.resultNames);
    const time = parseTime(t) ?? undefined;
    if (/\b(details?|more about|tell me|what is|what's|info)\b/.test(t)) {
      // With a single place on screen, "tell me more about it" can only mean that one.
      const target = index ?? (situation.resultNames.length === 1 ? 0 : null);
      if (target !== null) return { kind: 'details', index: target };
    }
    const picking = /\b(hold|book|take|reserve|choose|pick|go with|want|get|that one|this one)\b/.test(t) || t.split(' ').length <= 4;
    if ((index !== null || time) && picking) return time ? { kind: 'choose', index, time } : { kind: 'choose', index };
  }

  const fields = searchFields(text, situation.now);
  return Object.keys(fields).length > 0 ? { kind: 'search', fields } : { kind: 'unknown' };
}

/** Assumed times that fall inside the backend's opening hours (hotels: check-in). */
export const DEFAULT_TIMES: Record<ProviderType, string> = { restaurant: '19:00', salon: '13:00', hotel: '15:00' };
export const DEFAULT_LOCATION = 'Bangkok';

/** Fill what the guest did not say, and list those fields as assumed. */
export function completeSearch(
  fields: SearchFields,
  provider: ProviderType,
  now: Date,
): { input: SearchAvailabilityInput; assumed: Array<keyof SearchAvailabilityInput> } {
  const assumed: Array<keyof SearchAvailabilityInput> = [];
  const providerType = fields.provider_type ?? provider;
  const time = fields.time ?? DEFAULT_TIMES[providerType];
  if (!fields.time) assumed.push('time');
  let date = fields.date;
  if (!date) {
    // Today if that time is still at least half an hour away, otherwise tomorrow.
    const soon = splitIso(toBangkokIso(now.getTime() + 30 * 60_000));
    date = soon.date === bangkokDate(now) && soon.time <= time ? bangkokDate(now) : addDays(bangkokDate(now), 1);
    assumed.push('date');
  }
  if (!fields.location) assumed.push('location');
  if (!fields.party_size) assumed.push('party_size');
  return {
    assumed,
    input: {
      provider_type: providerType,
      location: fields.location ?? DEFAULT_LOCATION,
      date,
      time,
      party_size: fields.party_size ?? (providerType === 'salon' ? 1 : 2),
      service_type: providerType === 'salon' ? (fields.service_type ?? null) : null,
      room_type: providerType === 'hotel' ? (fields.room_type ?? null) : null,
      preferences: fields.preferences ?? [],
    },
  };
}
