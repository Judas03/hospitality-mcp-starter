import type { Availability } from '../contract/types';
import { priceLabel } from './format';
import { formatTime, splitIso } from './time';

export interface Place {
  listing_id: string;
  name: string;
  /** This place's options, best first, in the server's order. */
  slots: Availability[];
}

/** Search results grouped by place, places in order of their best option. */
export function groupByPlace(results: Availability[]): Place[] {
  const places = new Map<string, Place>();
  for (const result of results) {
    const place = places.get(result.listing_id);
    if (place) place.slots.push(result);
    else places.set(result.listing_id, { listing_id: result.listing_id, name: result.name, slots: [result] });
  }
  return [...places.values()];
}

/**
 * The option starting at HH:MM. "The 7:30 one" without AM or PM reads as 07:30, so when no
 * option starts then, the same time in the evening counts.
 */
export function findSlotAt(slots: Availability[], time: string): Availability | null {
  const at = (wanted: string) => slots.find((slot) => splitIso(slot.start_time).time === wanted) ?? null;
  const hour = Number(time.slice(0, 2));
  const evening = hour >= 1 && hour <= 11 ? `${String(hour + 12).padStart(2, '0')}${time.slice(2)}` : null;
  return at(time) ?? (evening ? at(evening) : null);
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The text on an option's button: its time, plus whatever else tells this place's options apart.
 * Only hotel rooms that share one check-in time leave the time out, since the card shows it.
 */
export function slotLabel(slot: Availability, place: Place): string {
  const parts: string[] = [];
  const oneTime = place.slots.every((other) => other.start_time === slot.start_time);
  const qualifier = slot.service_type ?? slot.room_type;
  const mixedOptions = new Set(place.slots.map((other) => other.service_type ?? other.room_type)).size > 1;
  const mixedPrices = new Set(place.slots.map((other) => other.price)).size > 1;
  if (!(oneTime && slot.provider_type === 'hotel')) parts.push(formatTime(slot.start_time));
  if (qualifier && (mixedOptions || oneTime)) parts.push(capitalize(qualifier));
  if (mixedPrices) parts.push(priceLabel(slot));
  return parts.join(' · ');
}
