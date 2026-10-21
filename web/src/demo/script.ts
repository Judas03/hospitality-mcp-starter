import type { Availability } from '../contract/types';
import { groupByPlace } from '../lib/places';

// The scripted demo for the recording (?script=main): one click per line, each sent exactly as
// if the guest had typed it, through the same tool calls as normal use.

export interface ScriptLine {
  /** What the guest says. */
  say: string;
  /** Just before this line, another guest holds the option it would pick, causing a real conflict. */
  rivalTakesBest?: boolean;
}

export const MAIN_SCRIPT: ScriptLine[] = [
  { say: 'Find a quiet restaurant for two tomorrow at 7 PM' },
  { say: 'Hold the first one', rivalTakesBest: true },
  { say: 'Hold the 7:30 PM one' },
  { say: 'Yes, confirm it' },
  { say: 'Move it to 8 PM' },
  { say: 'Make it 3 people' },
  { say: 'Cancel my booking' },
];

/** Synthetic, like the demo guest. */
export const RIVAL_GUEST = { guest_name: 'Another Guest', guest_contact: 'another.guest@example.com' } as const;

/** The option "Hold the first one" picks: the best place's best slot. */
export function bestOption(results: Availability[]): Availability | null {
  return groupByPlace(results)[0]?.slots[0] ?? null;
}
