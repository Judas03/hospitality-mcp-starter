import { useEffect, useRef, useState } from 'react';
import type { Availability } from '../contract/types';
import { describeSearch } from '../conversation/replies';
import { useNow } from '../hooks/useNow';
import {
  canConfirmPlan,
  canHoldPlan,
  canRemoveLeg,
  earliestExpiry,
  hasUnknownHold,
  holdsBookings,
  unresolvedLegs,
} from '../itinerary/flow';
import { describeLeg, legKind, unknownHold } from '../itinerary/replies';
import type { Itinerary, Leg, LegStatus, PlanPhase } from '../itinerary/types';
import type { Concierge } from '../itinerary/useOccasionConcierge';
import { partyLabel, priceLabel } from '../lib/format';
import { formatDate, formatRange, formatTime } from '../lib/time';
import { ProviderIcon } from './icons';

const PHASE_LABELS: Record<PlanPhase, string> = {
  searching: 'Searching every part',
  ready: 'Preview, nothing held yet',
  holding: 'Holding each part',
  awaiting_approval: 'Held, waiting for your yes',
  verifying: 'Checking the holds',
  confirming: 'Confirming',
  confirmed: 'Booked',
  rolling_back: 'Releasing the holds',
  cancelling: 'Cancelling',
  cancelled: 'Cancelled',
  cleanup_failed: 'Cleanup not verified',
};

const LEG_LABELS: Record<LegStatus, [label: string, tone?: string]> = {
  idle: ['Waiting'],
  searching: ['Searching'],
  selected: ['Not held'],
  holding: ['Holding', 'held'],
  held: ['On hold', 'held'],
  confirming: ['Confirming', 'held'],
  confirmed: ['Booked', 'confirmed'],
  failed: ['Needs a choice', 'expired'],
  expired: ['Hold ran out', 'expired'],
  cancelling: ['Releasing', 'held'],
  cancelled: ['Cancelled', 'cancelled'],
  unresolved: ['Not verified', 'expired'],
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function optionLabel(slot: Availability): string {
  const qualifier = slot.service_type ?? slot.room_type;
  return [slot.name, formatTime(slot.start_time), qualifier && capitalize(qualifier), priceLabel(slot)].filter(Boolean).join(' · ');
}

/** The Occasion Concierge's plan: every leg, the earliest hold, and what the guest can do next. */
export function ItineraryPanel({ concierge, blocked }: { concierge: Concierge; blocked: boolean }) {
  const plan = concierge.plan!;
  const busy = blocked || plan.busy;
  const unresolved = unresolvedLegs(plan);
  return (
    <section className="panel booking itinerary" aria-labelledby="plan-title">
      <div className="panel-head">
        <div>
          <h2 id="plan-title">Your plan</h2>
          <p className="panel-sub" aria-live="polite">
            {formatDate(plan.date)} · {PHASE_LABELS[plan.phase]}
          </p>
        </div>
      </div>
      <div className="panel-body">
        <PlanTimer plan={plan} />
        {plan.notice && (
          <div className="notice" data-tone="warn" role="alert">
            <p>{plan.notice}</p>
          </div>
        )}
        {unresolved.length > 0 && (
          <div className="notice" data-tone="error" role="alert">
            <p>
              <strong>Cleanup not verified.</strong> {unresolved.length === 1 ? 'This booking' : 'These bookings'} may still
              be active:
            </p>
            <ul className="unresolved">
              {unresolved.map((leg) => (
                <li key={leg.provider}>
                  <span className="reference">{leg.booking?.booking_id}</span> {describeLeg(leg)}
                  {leg.error && <span className="note"> ({leg.error.message})</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <ol className="legs" aria-label="Parts of the plan">
          {plan.legs.map((leg, index) => (
            <li key={leg.provider}>
              <LegCard leg={leg} index={index} plan={plan} busy={busy} concierge={concierge} />
            </li>
          ))}
        </ol>
        <PlanActions plan={plan} busy={busy} concierge={concierge} />
      </div>
    </section>
  );
}

const TIMED: PlanPhase[] = ['holding', 'awaiting_approval', 'verifying'];

/** The hold that runs out first, counting down. */
function PlanTimer({ plan }: { plan: Itinerary }) {
  const first = earliestExpiry(plan);
  const live = first !== null && TIMED.includes(plan.phase);
  const now = useNow(live);
  if (!first || !live) return null;
  const remaining = Math.max(0, Math.ceil((first.at - now) / 1000));
  return (
    <div className="card hold plan-timer">
      <span className="pill" data-tone="held">
        On hold
      </span>
      <span className="countdown" role="timer" aria-label={`The first hold ends in ${clock(remaining)}`}>
        {clock(remaining)}
      </span>
      <p className="meta">
        Held until {formatTime(new Date(first.at).toISOString())}. {capitalize(describeLeg(first.leg))} runs out first.
      </p>
    </div>
  );
}

function LegCard({
  leg,
  index,
  plan,
  busy,
  concierge,
}: {
  leg: Leg;
  index: number;
  plan: Itinerary;
  busy: boolean;
  concierge: Concierge;
}) {
  const [label, tone] = LEG_LABELS[leg.status];
  const editable = plan.phase === 'ready' && !busy;
  const slot = leg.selected;
  const titleId = `leg-${leg.provider}`;
  return (
    <article className="card leg" data-status={leg.status} aria-labelledby={titleId}>
      <header className="card-head">
        <span className="leg-kind" id={titleId}>
          <ProviderIcon provider={leg.provider} />
          <span className="capitalize">{legKind(leg)}</span>
        </span>
        <span className="pill" data-tone={tone}>
          {label}
        </span>
      </header>
      {slot ? (
        <>
          <h3>{slot.name}</h3>
          <p className="meta">
            {formatRange(slot.start_time, slot.end_time)} · {partyLabel(slot.party_size, slot.provider_type)} ·{' '}
            {priceLabel(slot)}
          </p>
        </>
      ) : (
        <p className="meta">{capitalize(describeSearch(leg.search))}</p>
      )}
      {leg.booking && (
        <p className="reference">
          {leg.booking.booking_id}
          {leg.status === 'held' && leg.booking.expires_at && ` · held until ${formatTime(leg.booking.expires_at)}`}
        </p>
      )}
      {leg.note && <p className="note">{leg.note}</p>}
      {leg.error && leg.status === 'failed' && (
        <p className="note" data-tone="error">
          {leg.error.message}
        </p>
      )}
      {leg.mayBeHeld && (
        <div className="notice" data-tone="warn" role="status">
          <p>{unknownHold(leg.mayBeHeld)}</p>
          <div className="actions">
            <button type="button" className="btn secondary small" onClick={concierge.checkAgain} disabled={busy}>
              Check again
            </button>
          </div>
        </div>
      )}
      {editable && leg.alternatives.length > 0 && (
        <ul className="alternatives" aria-label={`Alternatives for the ${legKind(leg)}`}>
          {leg.alternatives.map((alternative) => (
            <li key={alternative.availability_id}>
              <span>
                {alternative.name} at {formatTime(alternative.start_time)}
              </span>
              <button type="button" className="btn secondary small" onClick={() => concierge.pickOption(index, alternative)}>
                Use {formatTime(alternative.start_time)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {editable && leg.options.length > 1 && (
        <label className="leg-option">
          <span>Option</span>
          <select
            value={slot?.availability_id ?? ''}
            onChange={(event) => {
              const next = leg.options.find((option) => option.availability_id === event.target.value);
              if (next) concierge.pickOption(index, next);
            }}
          >
            {!slot && <option value="">Choose an option</option>}
            {leg.options.map((option) => (
              <option key={option.availability_id} value={option.availability_id}>
                {optionLabel(option)}
              </option>
            ))}
          </select>
        </label>
      )}
      {editable && leg.status === 'failed' && (
        <div className="actions">
          <button type="button" className="btn secondary small" onClick={() => concierge.retrySearch(index)}>
            Search again
          </button>
          {canRemoveLeg(plan, index) && (
            <button type="button" className="btn ghost small" onClick={() => concierge.removeLeg(index)}>
              Remove from plan
            </button>
          )}
        </div>
      )}
    </article>
  );
}

function PlanActions({ plan, busy, concierge }: { plan: Itinerary; busy: boolean; concierge: Concierge }) {
  const [askingCancel, setAskingCancel] = useState(false);
  // A hold that got no answer may still exist, so the plan can't be held, dropped or closed yet.
  const locked = hasUnknownHold(plan);
  switch (plan.phase) {
    case 'ready':
      return (
        <>
          <div className="actions">
            <button type="button" className="btn primary" onClick={concierge.holdPlan} disabled={busy || !canHoldPlan(plan)}>
              Hold whole plan
            </button>
            <button type="button" className="btn ghost" onClick={concierge.close} disabled={busy || holdsBookings(plan)}>
              Drop plan
            </button>
          </div>
          <p className="note">
            {locked
              ? 'The plan stays locked until the hold that got no answer is cleared.'
              : 'Nothing is held until you choose Hold whole plan.'}
          </p>
        </>
      );
    case 'awaiting_approval':
      return (
        <>
          <div className="actions">
            <button type="button" className="btn primary" onClick={concierge.confirmPlan} disabled={busy || !canConfirmPlan(plan)}>
              Confirm whole plan
            </button>
            <button type="button" className="btn secondary" onClick={concierge.cancelPlan} disabled={busy}>
              Cancel whole plan
            </button>
          </div>
          <p className="note">Nothing is booked until you confirm.</p>
        </>
      );
    case 'confirmed':
      return askingCancel ? (
        <CancelPlanConfirm
          count={plan.legs.length}
          busy={busy}
          onConfirm={() => {
            setAskingCancel(false);
            concierge.cancelPlan();
          }}
          onClose={() => setAskingCancel(false)}
        />
      ) : (
        <div className="actions">
          <button type="button" className="btn ghost" onClick={concierge.close} disabled={busy}>
            Done
          </button>
          <button type="button" className="btn danger-ghost" onClick={() => setAskingCancel(true)} disabled={busy}>
            Cancel whole plan
          </button>
        </div>
      );
    case 'cleanup_failed':
      return (
        <div className="actions">
          <button type="button" className="btn primary" onClick={concierge.retryCleanup} disabled={busy}>
            Retry cleanup
          </button>
        </div>
      );
    case 'cancelled':
      return (
        <div className="actions">
          <button type="button" className="btn ghost" onClick={concierge.close} disabled={busy || locked}>
            Close
          </button>
        </div>
      );
    default:
      return null;
  }
}

function CancelPlanConfirm({
  count,
  busy,
  onConfirm,
  onClose,
}: {
  count: number;
  busy: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepRef.current?.focus(), []);
  return (
    <div className="inline-form" role="group" aria-label="Cancel the whole plan">
      <p>Cancel {count === 2 ? 'both bookings' : `all ${count} bookings`}? This can’t be undone.</p>
      <div className="actions">
        <button type="button" className="btn danger small" onClick={onConfirm} disabled={busy}>
          Yes, cancel the plan
        </button>
        <button type="button" className="btn ghost small" onClick={onClose} ref={keepRef}>
          Keep it
        </button>
      </div>
    </div>
  );
}

/** Shown above the single-booking panel while a booked plan is put away. */
export function PlanStrip({ plan, onShow }: { plan: Itinerary; onShow(): void }) {
  return (
    <div className="strip">
      <span>
        <strong>Your plan:</strong> {plan.legs.length} bookings on {formatDate(plan.date)}
      </span>
      <button type="button" className="btn ghost small" onClick={onShow}>
        View
      </button>
    </div>
  );
}
