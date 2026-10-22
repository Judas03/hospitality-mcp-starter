import type { Availability, Booking, ProviderType, SearchAvailabilityInput } from '../contract/types';
import type { ToolError } from '../mcp/types';

// The Occasion Concierge: one request becomes a plan of independent bookings (legs), at most one
// per provider category, held one after another and confirmed together after one explicit yes.

/** What the reader makes of one part of a compound request. */
export interface PlannedLeg {
  search: SearchAvailabilityInput;
  /** Fields the guest did not say, filled with defaults the page shows as assumed. */
  assumed: Array<keyof SearchAvailabilityInput>;
}

export type ParsedItinerary =
  | { kind: 'plan'; date: string; legs: PlannedLeg[] }
  /** A compound request this version can't plan, with the reason to tell the guest. */
  | { kind: 'unsupported'; reason: string };

export type LegStatus =
  | 'idle'
  | 'searching'
  | 'selected'
  | 'holding'
  | 'held'
  | 'confirming'
  | 'confirmed'
  | 'failed'
  | 'expired'
  | 'cancelling'
  | 'cancelled'
  /** A release the server has not verified: the booking may still be active. */
  | 'unresolved';

export interface Leg {
  provider: ProviderType;
  search: SearchAvailabilityInput;
  assumed: Array<keyof SearchAvailabilityInput>;
  status: LegStatus;
  /** This leg's search results, in the server's order. */
  options: Availability[];
  /** The option the plan will hold. */
  selected: Availability | null;
  /** As the server last returned it; null once a rollback has released it. */
  booking: Booking | null;
  error: ToolError | null;
  /** Nearby options the server offered when this leg's hold was refused. */
  alternatives: Availability[];
  /** A short remark for the panel, e.g. "Released" after a rollback. */
  note: string | null;
  /** A hold request failed without a server answer, so a hold may exist that the page can't see. */
  mayBeHeld: boolean;
}

export type PlanPhase =
  | 'searching'
  | 'ready'
  | 'holding'
  | 'awaiting_approval'
  | 'verifying'
  | 'confirming'
  | 'confirmed'
  | 'rolling_back'
  | 'cancelling'
  | 'cancelled'
  | 'cleanup_failed';

export interface Itinerary {
  /** The one date every leg is on. */
  date: string;
  legs: Leg[];
  phase: PlanPhase;
  /** A tool step is running. */
  busy: boolean;
  /** What the panel says about the last thing that went wrong, if anything. */
  notice: string | null;
}
