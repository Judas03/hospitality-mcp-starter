import { useState, type FormEvent, type ReactNode } from 'react';
import type { CurrentBooking, FlowState, View } from '../booking/flow';
import type { Agent } from '../booking/useBookingAgent';
import type { ProviderType, SearchAvailabilityInput, SearchResult } from '../contract/types';
import { DEFAULT_LOCATION, DEFAULT_TIMES } from '../conversation/understand';
import { partyLabel, priceLabel } from '../lib/format';
import { addDays, bangkokDate, formatClockTime, formatDate, formatRange, formatTime } from '../lib/time';
import { BookingTicket, CancelledCard, ConflictCard, HoldCard, ListingDetails } from './BookingCards';
import { EmptyState, ErrorMessage, Skeleton } from './Feedback';
import { IconCalendar, IconCheck, IconClock, IconEdit, IconPin, IconSparkle, IconUsers, ProviderIcon } from './icons';

const STEPS = ['Search', 'Hold', 'Confirm', 'Change or cancel'];
const STEP_FOR_VIEW: Record<View, number> = { empty: 0, results: 1, held: 2, confirmed: 3, cancelled: 4 };

export function BookingPanel({ agent }: { agent: Agent }) {
  const { state } = agent;
  const [editing, setEditing] = useState(false);
  const busy = state.busy !== null;
  const detailsName =
    state.details &&
    (state.results.find((result) => result.listing_id === state.details?.listingId)?.name ??
      state.booking?.slot.name ??
      state.details.listingId);

  return (
    <section className="panel booking" aria-labelledby="booking-title">
      <div className="panel-head">
        <h2 id="booking-title">Booking</h2>
        <BookingSteps view={state.view} />
      </div>
      <div className="panel-body">
        {state.error && <ErrorMessage message={state.error.message} onRetry={agent.retry} onDismiss={agent.dismissError} />}
        {state.conflict && (
          <ConflictCard conflict={state.conflict} busy={busy} onChoose={(result) => void agent.chooseAlternative(result)} />
        )}
        {editing ? (
          <SearchForm
            state={state}
            guest={agent.guest}
            onSubmit={(input, guest) => {
              agent.setGuest(guest);
              setEditing(false);
              void agent.search(input);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <PanelContent agent={agent} onEdit={() => setEditing(true)} />
        )}
      </div>
      {state.details && detailsName && (
        <ListingDetails name={detailsName} data={state.details.data} onClose={agent.closeDetails} />
      )}
    </section>
  );
}

function PanelContent({ agent, onEdit }: { agent: Agent; onEdit(): void }) {
  const { state } = agent;
  const busy = state.busy !== null;
  const summary = state.search && (
    <SearchSummary search={state.search} assumed={state.assumed} onEdit={onEdit} disabled={busy} />
  );

  if (state.busy === 'search') {
    return (
      <>
        {summary}
        <Skeleton />
      </>
    );
  }
  if (state.view === 'held' && state.booking) {
    return (
      <HoldCard
        key={state.booking.record.booking_id}
        booking={state.booking}
        busy={busy}
        onConfirm={() => void agent.confirm()}
        onRelease={() => void agent.release()}
        onExpire={agent.expire}
        onSearchAgain={() => void agent.searchAgain()}
      />
    );
  }
  if (state.view === 'confirmed' && state.booking) {
    return (
      <BookingTicket
        booking={state.booking}
        busy={busy}
        onModify={(change) => void agent.modify(change)}
        onCancel={() => void agent.cancel()}
      />
    );
  }
  if (state.view === 'cancelled' && state.booking) {
    return <CancelledCard booking={state.booking} onStartOver={agent.startOver} />;
  }
  if (state.view === 'results' && state.search) {
    return (
      <>
        {state.booking?.record.status === 'confirmed' && <BookingStrip booking={state.booking} onShow={agent.showBooking} />}
        {summary}
        <ResultsList
          results={state.results}
          busy={busy}
          onHold={(result) => void agent.hold(result)}
          onDetails={(result) => void agent.showDetails(result.listing_id)}
        />
      </>
    );
  }
  return (
    <EmptyState title="Ask for a table, an appointment or a room">
      Options, holds and bookings show up here. Try “Find a quiet restaurant for two tomorrow at 7 PM”, or{' '}
      <button type="button" className="link" onClick={onEdit}>
        fill in a search form
      </button>
      .
    </EmptyState>
  );
}

export function BookingSteps({ view }: { view: View }) {
  const current = STEP_FOR_VIEW[view];
  return (
    <ol className="steps" aria-label="Booking steps">
      {STEPS.map((label, index) => {
        const status = index < current ? 'done' : index === current ? 'current' : 'todo';
        return (
          <li key={label} data-state={status} aria-current={status === 'current' ? 'step' : undefined}>
            <span className="step-mark" aria-hidden="true">
              {status === 'done' ? <IconCheck /> : index + 1}
            </span>
            {label}
            {status === 'done' && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

const ASSUMED_HINT = 'Assumed, since you didn’t say. Edit the search to change it.';

export function SearchSummary({
  search,
  assumed,
  onEdit,
  disabled,
}: {
  search: SearchAvailabilityInput;
  assumed: Array<keyof SearchAvailabilityInput>;
  onEdit(): void;
  disabled: boolean;
}) {
  const chip = (field: keyof SearchAvailabilityInput, icon: ReactNode, text: string) => {
    const isAssumed = assumed.includes(field);
    return (
      <li className={isAssumed ? 'fact assumed' : 'fact'}>
        {icon}
        {text}
        {isAssumed && (
          <span className="fact-note" title={ASSUMED_HINT}>
            assumed
          </span>
        )}
      </li>
    );
  };
  return (
    <div className="summary-bar">
      <ul className="facts" aria-label="What I searched for">
        <li className="fact">
          <ProviderIcon provider={search.provider_type} />
          {search.service_type ?? (search.room_type ? `${search.room_type} room` : search.provider_type)}
        </li>
        {chip('location', <IconPin />, search.location)}
        {chip('date', <IconCalendar />, formatDate(search.date))}
        {chip('time', <IconClock />, formatClockTime(search.time))}
        {chip('party_size', <IconUsers />, partyLabel(search.party_size, search.provider_type))}
        {search.preferences.map((preference) => (
          <li key={preference} className="fact wish">
            {preference}
          </li>
        ))}
      </ul>
      <button type="button" className="btn ghost small" onClick={onEdit} disabled={disabled}>
        <IconEdit />
        Edit
      </button>
    </div>
  );
}

const ROOM_TYPES = ['single', 'double', 'twin', 'suite', 'family'];
const SERVICE_TYPES = ['haircut', 'hair colour', 'blow dry', 'manicure', 'pedicure', 'massage', 'facial', 'beard trim'];

/** The same search as a form: the fallback when typing is not understood, and a way to correct it. */
export function SearchForm({
  state,
  guest,
  onSubmit,
  onCancel,
}: {
  state: FlowState;
  guest: { guest_name: string; guest_contact: string };
  onSubmit(input: SearchAvailabilityInput, guest: { guest_name: string; guest_contact: string }): void;
  onCancel(): void;
}) {
  const start = state.search;
  const [provider, setProvider] = useState<ProviderType>(start?.provider_type ?? state.provider);
  const [location, setLocation] = useState(start?.location ?? DEFAULT_LOCATION);
  const [date, setDate] = useState(start?.date ?? addDays(bangkokDate(new Date()), 1));
  const [time, setTime] = useState(start?.time ?? DEFAULT_TIMES[provider]);
  const [party, setParty] = useState(start?.party_size ?? 2);
  const [option, setOption] = useState(start?.service_type ?? start?.room_type ?? '');
  const [wishes, setWishes] = useState(start?.preferences.join(', ') ?? '');
  const [name, setName] = useState(guest.guest_name);
  const [contact, setContact] = useState(guest.guest_contact);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(
      {
        provider_type: provider,
        location: location.trim(),
        date,
        time,
        party_size: party,
        service_type: provider === 'salon' && option ? option : null,
        room_type: provider === 'hotel' && option ? option : null,
        preferences: wishes
          .split(',')
          .map((wish) => wish.trim().toLowerCase())
          .filter(Boolean),
      },
      { guest_name: name.trim(), guest_contact: contact.trim() },
    );
  };

  return (
    <form className="card search-form" onSubmit={submit} aria-labelledby="search-form-title">
      <h3 id="search-form-title">Search</h3>
      <div className="form-grid">
        <label>
          Type
          <select value={provider} onChange={(event) => setProvider(event.target.value as ProviderType)}>
            <option value="restaurant">Restaurant</option>
            <option value="salon">Salon</option>
            <option value="hotel">Hotel</option>
          </select>
        </label>
        <label>
          City
          <input value={location} onChange={(event) => setLocation(event.target.value)} required />
        </label>
        <label>
          Date
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <label>
          {provider === 'hotel' ? 'Check-in time' : 'Time'}
          <input type="time" step={900} value={time} onChange={(event) => setTime(event.target.value)} required />
        </label>
        <label>
          {provider === 'hotel' ? 'Guests' : 'People'}
          <input
            type="number"
            min={1}
            max={20}
            value={party}
            onChange={(event) => setParty(Math.max(1, Number(event.target.value) || 1))}
            required
          />
        </label>
        {provider !== 'restaurant' && (
          <label>
            {provider === 'salon' ? 'Service' : 'Room type'}
            <select value={option} onChange={(event) => setOption(event.target.value)}>
              <option value="">Any</option>
              {(provider === 'salon' ? SERVICE_TYPES : ROOM_TYPES).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="span-2">
          Wishes <span className="label-note">comma separated, e.g. quiet, outdoor</span>
          <input value={wishes} onChange={(event) => setWishes(event.target.value)} />
        </label>
        <label>
          Guest name
          <input value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label>
          Contact
          <input value={contact} onChange={(event) => setContact(event.target.value)} required />
        </label>
      </div>
      <div className="actions">
        <button type="submit" className="btn primary" disabled={state.busy !== null}>
          Search
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function ResultsList({
  results,
  busy,
  onHold,
  onDetails,
}: {
  results: SearchResult[];
  busy: boolean;
  onHold(result: SearchResult): void;
  onDetails(result: SearchResult): void;
}) {
  if (results.length === 0) {
    return (
      <EmptyState title="Nothing free for that">
        Try another time or day, fewer wishes, or a different city. The demo data covers Bangkok.
      </EmptyState>
    );
  }
  return (
    <ol className="results" aria-label="Options">
      {results.map((result, index) => (
        <li key={`${result.listing_id}-${result.start_time}`}>
          <ResultCard result={result} position={index + 1} best={index === 0} busy={busy} onHold={onHold} onDetails={onDetails} />
        </li>
      ))}
    </ol>
  );
}

export function ResultCard({
  result,
  position,
  best,
  busy,
  onHold,
  onDetails,
}: {
  result: SearchResult;
  position: number;
  best: boolean;
  busy: boolean;
  onHold(result: SearchResult): void;
  onDetails(result: SearchResult): void;
}) {
  const titleId = `result-${result.listing_id}-${position}`;
  return (
    <article className="card result" aria-labelledby={titleId}>
      <span className="position" aria-hidden="true">
        {position}
      </span>
      <div className="result-main">
        <h3 id={titleId}>
          {result.name}
          {best && <span className="badge">Best match</span>}
        </h3>
        <p className="meta">
          {result.location} · {formatRange(result.start_time, result.end_time)}
        </p>
        <p className="reason">
          <IconSparkle />
          <span>
            <span className="sr-only">Why: </span>
            {result.reason}
          </span>
        </p>
      </div>
      <div className="result-side">
        <span className="price">{priceLabel(result)}</span>
        <button type="button" className="btn primary small" disabled={busy} onClick={() => onHold(result)}>
          Hold
          <span className="sr-only"> {result.name}</span>
        </button>
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => onDetails(result)}>
          Details
          <span className="sr-only"> about {result.name}</span>
        </button>
      </div>
    </article>
  );
}

function BookingStrip({ booking, onShow }: { booking: CurrentBooking; onShow(): void }) {
  return (
    <div className="strip">
      <span>
        <strong>Your booking:</strong> {booking.slot.name}, {formatDate(booking.slot.start_time)} at{' '}
        {formatTime(booking.slot.start_time)}
      </span>
      <button type="button" className="btn ghost small" onClick={onShow}>
        View
      </button>
    </div>
  );
}
