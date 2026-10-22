import { describe, expect, it } from 'vitest';
import type { Itinerary, PlanPhase } from './types';
import { commandFor, planSuggestions, type Command } from './useOccasionConcierge';

const inPhase = (phase: PlanPhase): Itinerary => ({ date: '2026-10-23', legs: [], phase, busy: false, notice: null });

describe('commandFor: what the plan takes from the conversation', () => {
  it('holds or drops a previewed plan, and leaves other requests to the single-booking flow', () => {
    const ready = inPhase('ready');
    expect(commandFor('Yes', ready, true)).toBe('hold');
    expect(commandFor('Hold the whole plan', ready, true)).toBe('hold');
    expect(commandFor('Drop the plan', ready, true)).toBe('drop');
    expect(commandFor('no', ready, true)).toBe('drop');
    expect(commandFor('Book a haircut for one tomorrow at 1 PM', ready, true)).toBeNull();
  });

  it('confirms or cancels held legs only on clear words', () => {
    const held = inPhase('awaiting_approval');
    expect(commandFor('Yes, confirm the whole plan', held, true)).toBe('confirm');
    expect(commandFor('confirm', held, true)).toBe('confirm');
    expect(commandFor('No, cancel the plan', held, true)).toBe('cancel');
    expect(commandFor('Yes, cancel it', held, true)).toBe('cancel');
    expect(commandFor('Find a table for 4 on Saturday', held, true)).toBeNull();
  });

  it('takes "cancel" for a booked plan on screen, but only explicit plan words once it is put away', () => {
    const booked = inPhase('confirmed');
    expect(commandFor('Cancel my booking', booked, true)).toBe('cancel');
    expect(commandFor('Cancel my booking', booked, false)).toBeNull();
    expect(commandFor('Cancel the whole plan', booked, false)).toBe('cancel');
    expect(commandFor('Show my plan', booked, false)).toBe('show');
    expect(commandFor('yes', booked, true)).toBe('already_booked');
  });

  it('retries a cleanup the server has not verified', () => {
    expect(commandFor('Retry cleanup', inPhase('cleanup_failed'), true)).toBe('retry');
    expect(commandFor('yes', inPhase('cleanup_failed'), true)).toBe('retry');
  });

  it('reads every chip it offers as the command it is meant for', () => {
    const expected: Partial<Record<PlanPhase, Command[]>> = {
      ready: ['hold', 'drop'],
      awaiting_approval: ['confirm', 'cancel'],
      confirmed: ['cancel'],
      cleanup_failed: ['retry'],
    };
    for (const [phase, commands] of Object.entries(expected)) {
      const plan = inPhase(phase as PlanPhase);
      expect(planSuggestions(plan)?.map((chip) => commandFor(chip, plan, true))).toEqual(commands);
    }
  });
});
