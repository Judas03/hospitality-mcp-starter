import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Conflict, CurrentBooking } from '../booking/flow';
import type { Change } from '../booking/useBookingAgent';
import type { ListingDetails as Details, SearchResult } from '../contract/types';
import { useNow } from '../hooks/useNow';
import { displayValue, humanizeKey, partyLabel } from '../lib/format';
import { formatRange, formatTime, splitIso } from '../lib/time';
import { Skeleton } from './Feedback';
import { IconClose } from './icons';

function SlotFacts({ booking }: { booking: CurrentBooking }) {
  const { slot, partySize, guest } = booking;
  return (
    <>
      <h3>{slot.name}</h3>
      <p className="meta">
        {slot.location} · {formatRange(slot.start_time, slot.end_time)}
      </p>
      <p className="meta">
        {partyLabel(partySize, slot.provider_type)} · {guest.guest_name} ({guest.guest_contact})
      </p>
    </>
  );
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function HoldCard({
  booking,
  busy,
  onConfirm,
  onRelease,
  onExpire,
  onSearchAgain,
}: {
  booking: CurrentBooking;
  busy: boolean;
  onConfirm(): void;
  onRelease(): void;
  onExpire(): void;
  onSearchAgain(): void;
}) {
  const live = booking.record.status === 'held';
  const now = useNow(live);
  const expiresAt = booking.record.expires_at ? Date.parse(booking.record.expires_at) : null;
  const remaining = expiresAt === null ? null : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  // The parent keys this card by booking, so this is the hold's length as first seen.
  const [total] = useState(() => Math.max(remaining ?? 1, 1));

  useEffect(() => {
    if (live && remaining === 0) onExpire();
  }, [live, remaining, onExpire]);

  if (!live) {
    return (
      <article className="card hold" data-tone="expired" aria-labelledby="hold-title">
        <header className="card-head">
          <span className="pill" data-tone="expired" id="hold-title">
            Hold expired
          </span>
        </header>
        <SlotFacts booking={booking} />
        <p className="note">This hold ran out before it was confirmed, so the slot was released.</p>
        <div className="actions">
          <button type="button" className="btn primary" onClick={onSearchAgain} disabled={busy}>
            Find this time again
          </button>
        </div>
      </article>
    );
  }

  return (
    <article className="card hold" aria-labelledby="hold-title">
      <header className="card-head">
        <span className="pill" data-tone="held" id="hold-title">
          On hold
        </span>
        {remaining !== null && (
          <span className="countdown" role="timer" aria-label={`Hold ends in ${clock(remaining)}`}>
            {clock(remaining)}
          </span>
        )}
      </header>
      {remaining !== null && (
        <div
          className="progress"
          role="progressbar"
          aria-label="Time left on the hold"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={remaining}
        >
          <span style={{ width: `${Math.min(100, (remaining / total) * 100)}%` }} />
        </div>
      )}
      <SlotFacts booking={booking} />
      <p className="summary-text">{booking.record.summary}</p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onConfirm} disabled={busy}>
          Confirm booking
        </button>
        <button type="button" className="btn secondary" onClick={onRelease} disabled={busy}>
          Release hold
        </button>
      </div>
      <p className="note">Nothing is booked until you confirm.</p>
    </article>
  );
}

export function BookingTicket({
  booking,
  busy,
  onModify,
  onCancel,
}: {
  booking: CurrentBooking;
  busy: boolean;
  onModify(change: Change): void;
  onCancel(): void;
}) {
  const [mode, setMode] = useState<'view' | 'modify' | 'cancel'>('view');
  return (
    <article className="card ticket" aria-labelledby="ticket-title">
      <header className="card-head">
        <span className="pill" data-tone="confirmed" id="ticket-title">
          Confirmed
        </span>
        <span className="reference">{booking.record.booking_id}</span>
      </header>
      <SlotFacts booking={booking} />
      <p className="summary-text">{booking.record.summary}</p>
      {mode === 'view' && (
        <div className="actions">
          <button type="button" className="btn secondary" onClick={() => setMode('modify')} disabled={busy}>
            Change
          </button>
          <button type="button" className="btn danger-ghost" onClick={() => setMode('cancel')} disabled={busy}>
            Cancel booking
          </button>
        </div>
      )}
      {mode === 'modify' && (
        <ModifyForm
          booking={booking}
          busy={busy}
          onSubmit={(change) => {
            setMode('view');
            onModify(change);
          }}
          onClose={() => setMode('view')}
        />
      )}
      {mode === 'cancel' && (
        <CancelConfirm
          busy={busy}
          onConfirm={() => {
            setMode('view');
            onCancel();
          }}
          onClose={() => setMode('view')}
        />
      )}
    </article>
  );
}

export function ModifyForm({
  booking,
  busy,
  onSubmit,
  onClose,
}: {
  booking: CurrentBooking;
  busy: boolean;
  onSubmit(change: Change): void;
  onClose(): void;
}) {
  const start = splitIso(booking.slot.start_time);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [party, setParty] = useState(booking.partySize);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({ date, time, partySize: party });
  };
  return (
    <form className="inline-form" onSubmit={submit} aria-label="Change the booking">
      <div className="form-grid three">
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>
          Time
          <input type="time" step={900} value={time} onChange={(event) => setTime(event.target.value)} required />
        </label>
        <label>
          {booking.slot.provider_type === 'hotel' ? 'Guests' : 'People'}
          <input
            type="number"
            min={1}
            max={20}
            value={party}
            onChange={(event) => setParty(Math.max(1, Number(event.target.value) || 1))}
          />
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="btn primary small" disabled={busy}>
          Save change
        </button>
        <button type="button" className="btn ghost small" onClick={onClose}>
          Back
        </button>
      </div>
    </form>
  );
}

export function CancelConfirm({ busy, onConfirm, onClose }: { busy: boolean; onConfirm(): void; onClose(): void }) {
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => keepRef.current?.focus(), []);
  return (
    <div className="inline-form" role="group" aria-label="Cancel the booking">
      <p>Cancel this booking? This can’t be undone.</p>
      <div className="actions">
        <button type="button" className="btn danger small" onClick={onConfirm} disabled={busy}>
          Yes, cancel it
        </button>
        <button type="button" className="btn ghost small" onClick={onClose} ref={keepRef}>
          Keep it
        </button>
      </div>
    </div>
  );
}

export function CancelledCard({ booking, onStartOver }: { booking: CurrentBooking; onStartOver(): void }) {
  return (
    <article className="card" data-tone="cancelled" aria-labelledby="cancelled-title">
      <header className="card-head">
        <span className="pill" data-tone="cancelled" id="cancelled-title">
          Cancelled
        </span>
        <span className="reference">{booking.record.booking_id}</span>
      </header>
      <SlotFacts booking={booking} />
      <p className="summary-text">{booking.record.summary}</p>
      <div className="actions">
        <button type="button" className="btn primary" onClick={onStartOver}>
          Start a new search
        </button>
      </div>
    </article>
  );
}

export function ConflictCard({
  conflict,
  busy,
  onChoose,
}: {
  conflict: Conflict;
  busy: boolean;
  onChoose(result: SearchResult): void;
}) {
  const changing = conflict.during === 'modify';
  return (
    <div className="notice" data-tone="warn" role="alert">
      <p>
        <strong>{changing ? 'Couldn’t change the booking.' : 'That slot is gone.'}</strong> {conflict.message}
      </p>
      {conflict.alternatives.length === 0 && <p>Nothing close is free. Try another time.</p>}
      {!changing && conflict.alternatives.length > 0 && <p>The closest alternatives are listed below.</p>}
      {changing && conflict.alternatives.length > 0 && (
        <ul className="alternatives">
          {conflict.alternatives.map((result) => (
            <li key={result.start_time}>
              <span>
                {result.name} at {formatTime(result.start_time)}
              </span>
              <button type="button" className="btn secondary small" disabled={busy} onClick={() => onChoose(result)}>
                Move to {formatTime(result.start_time)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ListingDetails({ name, data, onClose }: { name: string; data: Details | null; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus(), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const rows = data ? Object.entries(data).filter(([key]) => key !== 'name' && key !== 'listing_id') : [];
  return (
    <div className="sheet" role="dialog" aria-labelledby="details-title">
      <header className="sheet-head">
        <h3 id="details-title">{name}</h3>
        <button type="button" className="btn ghost icon-only" onClick={onClose} aria-label="Close details" ref={closeRef}>
          <IconClose />
        </button>
      </header>
      {data ? (
        <dl className="details-list">
          {rows.map(([key, value]) => (
            <div key={key}>
              <dt>{humanizeKey(key)}</dt>
              <dd>{displayValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <Skeleton count={1} />
      )}
    </div>
  );
}
