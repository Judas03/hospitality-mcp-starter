import { useState, type FormEvent, type ReactNode } from 'react';
import type { CurrentBooking, FlowState, View } from '../booking/flow';
import type { Agent } from '../booking/useBookingAgent';
import type { Availability, ProviderType, SearchAvailabilityInput } from '../contract/types';
import { DEFAULT_LOCATION, DEFAULT_TIMES } from '../conversation/understand';
import { durationLabel, partyLabel, priceLabel } from '../lib/format';
import { groupByPlace, type Place } from '../lib/places';
import { addDays, bangkokDate, formatClockTime, formatDate, formatTime } from '../lib/time';
import { BookingTicket, CancelledCard, ConflictCard, HoldCard, ListingDetails } from './BookingCards';
import { EmptyState, ErrorMessage, Skeleton } from './Feedback';
import { IconCalendar, IconCheck, IconClock, IconEdit, IconPin, IconSparkle, IconUsers, ProviderIcon } from './icons';

const STEPS = ['Search', 'Hold', 'Confirm', 'Change or cancel'];
const STEP_FOR_VIEW: Record<View, number> = { empty: 0, results: 1, held: 2, confirmed: 3, cancelled: 4 };

export function BookingPanel({ agent }: { agent: Agent }) {
  const { state } = agent;
  const [editing, setEditing] = useState(false);
  const busy = state.busy !== null;

  return (
    <section className="panel booking" aria-labelledby="booking-title">
      <div className="panel-head">
        <h2 id="booking-title">Booking</h2>
        <BookingSteps view={state.view} />
      </div>
      <div className="panel-body">
        {state.error && <ErrorMessage message={state.error.message} onRetry={agent.retry} onDismiss={agent.dismissError} />}
        {state.conflict && (
          <ConflictCard conflict={state.conflict} busy={busy} onChoose={(slot) => void agent.chooseAlternative(slot)} />
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
      {state.details && <ListingDetails listing={state.details.listing} onClose={agent.closeDetails} />}
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
  if (state.view === 'held' && state.current) {
    return (
      <HoldCard
        key={state.current.booking.booking_id}
        current={state.current}
        busy={busy}
        onConfirm={() => void agent.confirm()}
        onRelease={() => void agent.release()}
        onExpire={agent.expire}
        onSearchAgain={() => void agent.searchAgain()}
      />
    );
  }
  if (state.view === 'confirmed' && state.current) {
    return (
      <BookingTicket
        current={state.current}
        busy={busy}
        onModify={(change) => void agent.modify(change)}
        onCancel={() => void agent.cancel()}
      />
    );
  }
  if (state.view === 'cancelled' && state.current) {
    return <CancelledCard current={state.current} onStartOver={agent.startOver} />;
  }
  if (state.view === 'results' && state.search) {
    return (
      <>
        {state.current?.booking.status === 'confirmed' && <BookingStrip current={state.current} onShow={agent.showBooking} />}
        {summary}
        <ResultsList
          results={state.results}
          busy={busy}
          onHold={(slot) => void agent.hold(slot)}
          onDetails={(listingId) => void agent.showDetails(listingId)}
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

const ROOM_TYPES = ['standard', 'deluxe', 'suite'];
const SERVICE_TYPES = ['haircut', 'manicure'];

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
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as ProviderType);
              setOption('');
            }}
          >
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
            onChange={(event) => setParty(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
            required
          />
        </label>
        {provider !== 'restaurant' && (
          <label>
            {provider === 'salon' ? 'Service' : 'Room type'}
            <select value={option} onChange={(event) => setOption(event.target.value)}>
              <option value="">Any</option>
              {(provider === 'salon' ? SERVICE_TYPES : ROOM_TYPES).map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="span-2">
          Wishes <span className="label-note">comma separated, e.g. quiet, river view, outdoor seating</span>
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
  results: Availability[];
  busy: boolean;
  onHold(slot: Availability): void;
  onDetails(listingId: string): void;
}) {
  if (results.length === 0) {
    return (
      <EmptyState title="Nothing free for that">
        Try another time or day, or fewer wishes. Every wish has to match the place.
      </EmptyState>
    );
  }
  return (
    <ol className="results" aria-label="Options">
      {groupByPlace(results).map((place, index) => (
        <li key={place.listing_id}>
          <PlaceCard place={place} position={index + 1} busy={busy} onHold={onHold} onDetails={onDetails} />
        </li>
      ))}
    </ol>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The text on a slot button: only what tells this place's options apart. */
function slotLabel(slot: Availability, place: Place): string {
  const parts: string[] = [];
  const oneTime = place.slots.every((other) => other.start_time === slot.start_time);
  const qualifier = slot.service_type ?? slot.room_type;
  const mixedOptions = new Set(place.slots.map((other) => other.service_type ?? other.room_type)).size > 1;
  const mixedPrices = new Set(place.slots.map((other) => other.price)).size > 1;
  if (!oneTime) parts.push(formatTime(slot.start_time));
  if (qualifier && (mixedOptions || oneTime)) parts.push(capitalize(qualifier));
  if (mixedPrices) parts.push(priceLabel(slot));
  return parts.join(' · ');
}

function placeMeta(slot: Availability): string {
  if (slot.provider_type === 'hotel') {
    return `${slot.location} · check-in ${formatDate(slot.start_time)} ${formatTime(slot.start_time)}, check-out ${formatDate(slot.end_time)} ${formatTime(slot.end_time)}`;
  }
  return `${slot.location} · ${formatDate(slot.start_time)} · ${durationLabel(slot.start_time, slot.end_time)}`;
}

export function PlaceCard({
  place,
  position,
  busy,
  onHold,
  onDetails,
}: {
  place: Place;
  position: number;
  busy: boolean;
  onHold(slot: Availability): void;
  onDetails(listingId: string): void;
}) {
  const [best] = place.slots;
  const titleId = `place-${place.listing_id}`;
  const prices = place.slots.map((slot) => slot.price);
  const cheapest = place.slots[prices.indexOf(Math.min(...prices))];
  return (
    <article className="card result" aria-labelledby={titleId}>
      <span className="position" aria-hidden="true">
        {position}
      </span>
      <div className="result-main">
        <h3 id={titleId}>
          {place.name}
          {position === 1 && <span className="badge">Best match</span>}
        </h3>
        <p className="meta">{placeMeta(best)}</p>
        <p className="reason">
          <IconSparkle />
          <span>
            <span className="sr-only">Why: </span>
            {best.reason}
          </span>
        </p>
        <ul className="slots" aria-label={`Options at ${place.name}`}>
          {place.slots.map((slot, index) => (
            <li key={slot.availability_id}>
              <button
                type="button"
                className={index === 0 ? 'slot best' : 'slot'}
                disabled={busy}
                onClick={() => onHold(slot)}
              >
                <span className="sr-only">Hold </span>
                {slotLabel(slot, place)}
                <span className="sr-only"> at {place.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="result-side">
        <span className="price">{new Set(prices).size > 1 ? `from ${priceLabel(cheapest)}` : priceLabel(best)}</span>
        <button type="button" className="btn ghost small" disabled={busy} onClick={() => onDetails(place.listing_id)}>
          Details
          <span className="sr-only"> about {place.name}</span>
        </button>
      </div>
    </article>
  );
}

function BookingStrip({ current, onShow }: { current: CurrentBooking; onShow(): void }) {
  return (
    <div className="strip">
      <span>
        <strong>Your booking:</strong> {current.slot.name}, {formatDate(current.booking.start_time)} at{' '}
        {formatTime(current.booking.start_time)}
      </span>
      <button type="button" className="btn ghost small" onClick={onShow}>
        View
      </button>
    </div>
  );
}
