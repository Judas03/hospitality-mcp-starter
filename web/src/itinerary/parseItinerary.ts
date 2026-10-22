import type { ProviderType } from '../contract/types';
import {
  completeSearch,
  DEFAULT_TIMES,
  parseDate,
  parseLocation,
  parsePartySize,
  parseProvider,
  parseTime,
  searchFields,
} from '../conversation/understand';
import { addDays, bangkokDate, formatDate, splitIso, toBangkokIso } from '../lib/time';
import type { ParsedItinerary, PlannedLeg } from './types';

// Reads one compound request as a plan: deterministic and deliberately narrow. Each part is read
// by the same rules as a single request, so "a quiet dinner for two at 7 PM" means the same thing
// inside a plan as on its own.

export const ONE_PER_CATEGORY = 'I can plan one salon visit, one meal and one hotel stay at a time.';

// Parts of a request are separated by commas, semicolons, "&", "and", "then" or "plus".
const PART_BREAK = /\s*[,;&]\s*|\s+(?:and|then|plus)\s+/i;
const LEADING_JOINER = /^(?:and|then|plus)\s+/i;
// A colon starts the list of parts unless it is part of a time such as 7:30.
const HEADER_END = /:(?!\d)/;

function partsOf(text: string): string[] {
  return text
    .split(PART_BREAK)
    .map((part) => part.replace(LEADING_JOINER, '').replace(/[.!?]+$/, '').trim())
    .filter(Boolean);
}

/**
 * A plan when the request has parts in at least two categories, "unsupported" when it is a plan
 * this version can't make, and null for everything else, which the single-booking flow handles.
 */
export function parseItinerary(text: string, now: Date): ParsedItinerary | null {
  const colon = text.search(HEADER_END);
  // The header ("Plan my anniversary tomorrow in Bangkok") holds what every part shares.
  let header = colon >= 0 ? text.slice(0, colon).trim() : '';
  const parts: Array<{ provider: ProviderType; text: string }> = [];
  for (const part of partsOf(colon >= 0 ? text.slice(colon + 1) : text)) {
    const provider = parseProvider(part);
    if (provider) parts.push({ provider, text: part });
    // A part that names no category adds to the one before it ("dinner at 7 PM, outside").
    else if (parts.length > 0) parts[parts.length - 1].text += `, ${part}`;
    else header = `${header} ${part}`.trim();
  }

  const categories = new Set(parts.map((part) => part.provider));
  if (categories.size < 2) return null;
  if (categories.size < parts.length) return { kind: 'unsupported', reason: ONE_PER_CATEGORY };

  // One date for the whole plan, so it never splits across days by accident.
  const named = [...new Set([header, ...parts.map((part) => part.text)].map((words) => parseDate(words, now)))]
    .filter((date): date is string => date !== null)
    .sort();
  if (named.length > 1) {
    return {
      kind: 'unsupported',
      reason: `This plan names more than one day (${named.map(formatDate).join(' and ')}). I can plan one day at a time, so ask for each day separately.`,
    };
  }
  let date = named[0];
  const dateAssumed = date === undefined;
  if (date === undefined) {
    // Today if every part is still at least half an hour away, otherwise tomorrow.
    const today = bangkokDate(now);
    const soon = splitIso(toBangkokIso(now.getTime() + 30 * 60_000));
    const times = parts.map((part) => parseTime(part.text) ?? DEFAULT_TIMES[part.provider]);
    date = soon.date === today && times.every((time) => time >= soon.time) ? today : addDays(today, 1);
  }

  const location = parseLocation(header);
  const partySize = parsePartySize(header);
  const legs: PlannedLeg[] = parts.map(({ provider, text: words }) => {
    const fields = { ...searchFields(words, now), provider_type: provider, date };
    if (!fields.location && location) fields.location = location;
    // "For two" in the header is the table and the room; a salon visit stays one person unless said.
    if (!fields.party_size && partySize && provider !== 'salon') fields.party_size = partySize;
    const { input, assumed } = completeSearch(fields, provider, now);
    return { search: input, assumed: dateAssumed ? [...assumed, 'date'] : assumed };
  });
  return { kind: 'plan', date, legs };
}
