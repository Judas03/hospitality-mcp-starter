import type { Availability } from '../contract/types';

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
