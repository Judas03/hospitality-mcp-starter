import {
  PROVIDER_TYPES,
  type Availability,
  type Booking,
  type BookingRef,
  type BookingResult,
  type BusinessErrorCode,
  type BusinessErrorPayload,
  type ConfirmBookingInput,
  type CreateBookingHoldInput,
  type Listing,
  type ModifyBookingInput,
  type SearchAvailabilityInput,
  type ToolArgs,
  type ToolName,
  type ToolOutputs,
} from '../contract/types';
import { addMinutes, formatTime, splitIso, toIsoDateTime } from '../lib/time';
import {
  DEMO_LISTINGS,
  DEMO_TEMPLATES,
  HOLD_SECONDS,
  MAX_RESULTS,
  SEARCH_WINDOW_MINUTES,
  type DemoTemplate,
} from './demoData';
import { readToolResult, type CallToolResultLike } from './result';
import {
  CLIENT_INFO,
  PROTOCOL_VERSION,
  type LogMethod,
  type LogSink,
  type ServerInfo,
  type ToolClient,
  type ToolInfo,
  type ToolOutcome,
} from './types';

// A browser-only stand-in for the backend that follows its rules (server/service.py and
// server/providers.py on backend-codex): same inventory, same errors, same summaries.

export const DEMO_TOOLS: ToolInfo[] = [
  { name: 'search_availability', description: 'Search real demo inventory and explain why each option matches.' },
  { name: 'get_listing_details', description: 'Return descriptive details and supported services or room types for one listing.' },
  { name: 'create_booking_hold', description: 'Create a short booking hold without confirming the reservation.' },
  { name: 'confirm_booking', description: 'Confirm an active hold only after explicit user approval.' },
  { name: 'modify_booking', description: 'Atomically change an active held or confirmed booking.' },
  { name: 'cancel_booking', description: 'Cancel an active booking; repeating the call is safe.' },
  { name: 'get_booking', description: 'Return the current booking status after applying hold expiry.' },
];

export const DEMO_SERVER_NAME = 'Demo data (this browser tab)';

export interface DemoClientOptions {
  now?: () => Date;
  /** How long a hold lasts before it expires. */
  holdSeconds?: number;
  /** Pretend network time, so loading states are visible. */
  latencyMs?: number;
}

interface Occurrence {
  availability_id: string;
  listing: Listing;
  template: DemoTemplate;
  start_time: string;
  end_time: string;
}

class BusinessFailure {
  constructor(readonly payload: BusinessErrorPayload) {}
}

function raise(
  code: BusinessErrorCode,
  message: string,
  retryable: boolean,
  context: { booking?: Booking; bookingId?: string; alternatives?: Availability[] } = {},
): never {
  throw new BusinessFailure({
    error: {
      code,
      message,
      retryable,
      booking_id: context.booking?.booking_id ?? context.bookingId ?? null,
      current_status: context.booking?.status ?? null,
    },
    alternatives: context.alternatives ?? [],
  });
}

/** Input the server's schema would reject: plain text, like its validation errors. */
class InvalidInput {
  constructor(readonly message: string) {}
}

const compact = (data: unknown) => JSON.stringify(data);
const success = (data: object): CallToolResultLike => ({
  content: [{ type: 'text', text: compact(data) }],
  structuredContent: data,
  isError: false,
});
const failure = (payload: BusinessErrorPayload): CallToolResultLike => ({
  content: [{ type: 'text', text: compact(payload) }],
  structuredContent: payload,
  isError: true,
});

const wait = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const titleCase = (text: string) => text.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
const randomHex = (length: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(length / 2)), (byte) => byte.toString(16).padStart(2, '0')).join('');

function reasonFor(listing: Listing, template: DemoTemplate, request: SearchAvailabilityInput): string {
  if (listing.provider_type === 'salon') return `A ${template.service_type} appointment is available at ${listing.name}`;
  if (listing.provider_type === 'hotel') {
    return `A ${template.room_type} room for ${request.party_size} is available at ${listing.name}`;
  }
  const wishes = request.preferences.length > 0 ? `${titleCase(request.preferences.join(', '))} seating and ` : '';
  return `${wishes}a table for ${request.party_size} is available at ${listing.name}`;
}

function matches(listing: Listing, template: DemoTemplate, request: SearchAvailabilityInput): boolean {
  if (request.party_size > template.max_party_size) return false;
  const wanted = listing.provider_type === 'salon' ? request.service_type : listing.provider_type === 'hotel' ? request.room_type : null;
  const offered = listing.provider_type === 'salon' ? template.service_type : template.room_type;
  if (wanted && wanted.toLowerCase() !== (offered ?? '').toLowerCase()) return false;
  const features = new Set(listing.features.map((feature) => feature.toLowerCase()));
  return request.preferences.every((preference) => features.has(preference.toLowerCase()));
}

function availabilityId(listing: Listing, template: DemoTemplate, date: string): string {
  const qualifier = template.service_type ?? template.room_type;
  const base = `avail_${listing.listing_id}_${date.replace(/-/g, '')}_${template.local_start.replace(':', '')}`;
  return qualifier ? `${base}_${qualifier.toLowerCase().replace(/ /g, '_')}` : base;
}

/**
 * Answers the contract's tools from the backend's sample inventory, entirely in the browser, so the
 * page works without the server and on a recording. Every exchange is logged as "demo".
 */
export class DemoClient implements ToolClient {
  readonly mode = 'demo' as const;
  readonly endpoint = null;
  private readonly now: () => Date;
  private readonly holdSeconds: number;
  private readonly latencyMs: number;
  private readonly occurrences = new Map<string, Occurrence>();
  private readonly bookings = new Map<string, Booking>();

  constructor(
    private readonly log: LogSink,
    options: DemoClientOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.holdSeconds = options.holdSeconds ?? HOLD_SECONDS;
    this.latencyMs = options.latencyMs ?? 350;
  }

  async connect(): Promise<ServerInfo> {
    const serverInfo = { name: DEMO_SERVER_NAME, version: '0.2.0' };
    await this.exchange('initialize', undefined, { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO }, () => ({
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo,
    }));
    await this.exchange('notifications/initialized', undefined, {}, () => undefined);
    await this.exchange('tools/list', undefined, {}, () => ({ tools: DEMO_TOOLS }));
    return { ...serverInfo, protocolVersion: PROTOCOL_VERSION, tools: DEMO_TOOLS };
  }

  async callTool<N extends ToolName>(name: N, args: ToolArgs[N]): Promise<ToolOutcome<ToolOutputs[N]>> {
    const result = await this.exchange('tools/call', name, { name, arguments: args }, () => this.run(name, args));
    return readToolResult<ToolOutputs[N]>(result as CallToolResultLike);
  }

  async close(): Promise<void> {}

  private async exchange(method: LogMethod, tool: string | undefined, request: unknown, respond: () => unknown) {
    const at = Date.now();
    await wait(this.latencyMs);
    const response = respond();
    const failed = method === 'tools/call' && (response as CallToolResultLike).isError === true;
    this.log({
      at,
      mode: this.mode,
      method,
      tool,
      request,
      response,
      ok: !failed,
      durationMs: Date.now() - at,
      errorMessage: failed ? (response as CallToolResultLike).content?.[0]?.text : undefined,
    });
    return response;
  }

  private run(name: ToolName, args: unknown): CallToolResultLike {
    try {
      switch (name) {
        case 'search_availability':
          return success({ results: this.search(this.checkSearch(args as SearchAvailabilityInput)) });
        case 'get_listing_details':
          return success(this.details((args as { listing_id: string }).listing_id));
        case 'create_booking_hold':
          return success(this.hold(args as CreateBookingHoldInput));
        case 'confirm_booking':
          return success(this.confirm(args as ConfirmBookingInput));
        case 'modify_booking':
          return success(this.modify(args as ModifyBookingInput));
        case 'cancel_booking':
          return success(this.cancel(args as BookingRef));
        case 'get_booking':
          return success(this.respond(this.requireBooking((args as BookingRef).booking_id)));
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${String(name)}` }], isError: true };
      }
    } catch (error) {
      if (error instanceof BusinessFailure) return failure(error.payload);
      if (error instanceof InvalidInput) {
        return { content: [{ type: 'text', text: `Error executing tool ${name}: ${error.message}` }], isError: true };
      }
      throw error;
    }
  }

  private checkSearch(input: SearchAvailabilityInput): SearchAvailabilityInput {
    if (!PROVIDER_TYPES.includes(input.provider_type)) throw new InvalidInput('provider_type must be restaurant, salon or hotel');
    if (!input.location?.trim()) throw new InvalidInput('location should have at least 1 character');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new InvalidInput('date should be a valid date (YYYY-MM-DD)');
    if (!/^\d{2}:\d{2}$/.test(input.time)) throw new InvalidInput('time should be a valid time (HH:MM)');
    if (!(input.party_size >= 1 && input.party_size <= 20)) throw new InvalidInput('party_size should be between 1 and 20');
    const preferences: string[] = [];
    for (const preference of input.preferences ?? []) {
      const item = preference.trim().toLowerCase();
      if (item && !preferences.includes(item)) preferences.push(item);
    }
    return { ...input, location: input.location.trim(), service_type: input.service_type || null, room_type: input.room_type || null, preferences };
  }

  /** The provider adapters' search: nearest start times first, at most ten. */
  private search(request: SearchAvailabilityInput): Availability[] {
    const now = this.now().getTime();
    const found: Array<{ distance: number; result: Availability }> = [];
    // Candidates in the backend's SQL order (listing, start time, template id), so ties sort the same.
    const listings = DEMO_LISTINGS.filter(
      (listing) =>
        listing.provider_type === request.provider_type && listing.location.toLowerCase() === request.location.toLowerCase(),
    ).sort((a, b) => a.listing_id.localeCompare(b.listing_id));
    for (const listing of listings) {
      const templates = DEMO_TEMPLATES.filter((candidate) => candidate.listing_id === listing.listing_id).sort(
        (a, b) => a.local_start.localeCompare(b.local_start) || a.template_id.localeCompare(b.template_id),
      );
      for (const template of templates) {
        if (!matches(listing, template, request)) continue;
        const distance = Math.abs(minutesOf(template.local_start) - minutesOf(request.time));
        if (distance > SEARCH_WINDOW_MINUTES) continue;
        const start = toIsoDateTime(request.date, template.local_start);
        const end = addMinutes(start, template.duration_minutes);
        if (Date.parse(end) <= now) continue;
        const id = availabilityId(listing, template, request.date);
        this.occurrences.set(id, { availability_id: id, listing, template, start_time: start, end_time: end });
        if (!this.isAvailable(id)) continue;
        found.push({
          distance,
          result: {
            availability_id: id,
            listing_id: listing.listing_id,
            name: listing.name,
            provider_type: listing.provider_type,
            location: listing.location,
            start_time: start,
            end_time: end,
            party_size: request.party_size,
            service_type: template.service_type,
            room_type: template.room_type,
            price: template.price,
            currency: template.currency,
            reason: reasonFor(listing, template, request),
          },
        });
      }
    }
    found.sort(
      (a, b) =>
        a.distance - b.distance ||
        Date.parse(a.result.start_time) - Date.parse(b.result.start_time) ||
        a.result.listing_id.localeCompare(b.result.listing_id),
    );
    return found.slice(0, MAX_RESULTS).map((entry) => entry.result);
  }

  private details(listingId: string) {
    const listing = DEMO_LISTINGS.find((candidate) => candidate.listing_id === listingId);
    if (!listing) raise('listing_not_found', 'The requested listing was not found.', false);
    return { listing };
  }

  private hold(input: CreateBookingHoldInput): BookingResult {
    if (!input.availability_id?.trim() || !input.guest_name?.trim() || !input.guest_contact?.trim()) {
      throw new InvalidInput('availability_id, guest_name and guest_contact should have at least 1 character');
    }
    if (!(input.party_size >= 1 && input.party_size <= 20)) throw new InvalidInput('party_size should be between 1 and 20');
    const now = this.now().getTime();
    const occurrence = this.occurrences.get(input.availability_id);
    if (!occurrence) {
      raise('availability_not_found', 'Search again and select one of the returned availability options.', true);
    }
    if (input.party_size > occurrence.template.max_party_size || Date.parse(occurrence.end_time) <= now) {
      raise('slot_unavailable', 'That option cannot accommodate the requested party.', true, {
        alternatives: this.alternatives(occurrence, input.party_size),
      });
    }
    if (!this.isAvailable(occurrence.availability_id)) {
      raise('slot_unavailable', 'That time is no longer available.', true, {
        alternatives: this.alternatives(occurrence, input.party_size),
      });
    }
    const stamp = new Date(now).toISOString();
    const booking: Booking = {
      booking_id: `booking_${randomHex(12)}`,
      availability_id: occurrence.availability_id,
      listing_id: occurrence.listing.listing_id,
      provider_type: occurrence.listing.provider_type,
      status: 'held',
      start_time: occurrence.start_time,
      end_time: occurrence.end_time,
      guest_name: input.guest_name.trim(),
      guest_contact: input.guest_contact.trim(),
      party_size: input.party_size,
      service_type: occurrence.template.service_type,
      room_type: occurrence.template.room_type,
      expires_at: new Date(now + this.holdSeconds * 1000).toISOString(),
      created_at: stamp,
      updated_at: stamp,
    };
    this.bookings.set(booking.booking_id, booking);
    return this.respond(booking);
  }

  private confirm(input: ConfirmBookingInput): BookingResult {
    if (typeof input.user_confirmed !== 'boolean') throw new InvalidInput('user_confirmed should be a valid boolean');
    const booking = this.requireBooking(input.booking_id);
    if (input.user_confirmed !== true) {
      raise('confirmation_required', 'Explicit user approval is required before confirmation.', true, { booking });
    }
    if (booking.status === 'expired') {
      raise('hold_expired', 'The booking hold has expired. Search again to create a new hold.', true, { booking });
    }
    if (booking.status === 'cancelled') raise('invalid_state', 'A cancelled booking cannot be confirmed.', false, { booking });
    if (booking.status === 'held') this.update(booking, { status: 'confirmed', expires_at: null });
    return this.respond(booking);
  }

  private modify(input: ModifyBookingInput): BookingResult {
    if (input.new_availability_id === undefined && input.party_size === undefined) {
      raise('invalid_state', 'new_availability_id or party_size is required.', true, { bookingId: input.booking_id });
    }
    const now = this.now().getTime();
    const current = this.requireBooking(input.booking_id);
    if (current.status !== 'held' && current.status !== 'confirmed') {
      raise('invalid_state', `A ${current.status} booking cannot be modified.`, false, { booking: current });
    }
    let occurrence = this.occurrences.get(input.new_availability_id ?? current.availability_id);
    if (input.new_availability_id !== undefined) {
      if (!occurrence) {
        raise('availability_not_found', 'Search again and select one of the returned availability options.', true, {
          booking: current,
        });
      }
      if (occurrence.listing.provider_type !== current.provider_type) {
        raise('invalid_state', 'A booking cannot be moved to a different provider type.', false, { booking: current });
      }
      if (Date.parse(occurrence.end_time) <= now) {
        raise('slot_unavailable', 'The replacement time has already passed.', true, { booking: current });
      }
    }
    if (!occurrence) {
      raise('availability_not_found', "The booking's availability record is missing. Search for a replacement.", true, {
        booking: current,
      });
    }
    const partySize = input.party_size || current.party_size;
    if (partySize > occurrence.template.max_party_size) {
      raise('slot_unavailable', 'The replacement option cannot accommodate the requested party.', true, {
        booking: current,
        alternatives: this.alternatives(occurrence, partySize),
      });
    }
    if (!this.isAvailable(occurrence.availability_id, current.booking_id)) {
      raise('slot_unavailable', 'That replacement time is no longer available; the original booking is unchanged.', true, {
        booking: current,
        alternatives: this.alternatives(occurrence, partySize),
      });
    }
    this.update(current, {
      ...(input.new_availability_id !== undefined && {
        availability_id: occurrence.availability_id,
        listing_id: occurrence.listing.listing_id,
        start_time: occurrence.start_time,
        end_time: occurrence.end_time,
        service_type: occurrence.template.service_type,
        room_type: occurrence.template.room_type,
      }),
      party_size: partySize,
    });
    return this.respond(current);
  }

  private cancel({ booking_id }: BookingRef): BookingResult {
    const booking = this.requireBooking(booking_id);
    if (booking.status === 'expired') raise('invalid_state', 'An expired booking cannot be cancelled.', false, { booking });
    if (booking.status === 'held' || booking.status === 'confirmed') this.update(booking, { status: 'cancelled', expires_at: null });
    return this.respond(booking);
  }

  /** Up to two other free times at the same listing, as the backend offers on a conflict. */
  private alternatives(occurrence: Occurrence, partySize: number): Availability[] {
    const { date, time } = splitIso(occurrence.start_time);
    return this.search({
      provider_type: occurrence.listing.provider_type,
      location: occurrence.listing.location,
      date,
      time,
      party_size: partySize,
      service_type: occurrence.template.service_type,
      room_type: occurrence.template.room_type,
      preferences: [],
    })
      .filter((result) => result.listing_id === occurrence.listing.listing_id && result.availability_id !== occurrence.availability_id)
      .slice(0, 2);
  }

  private requireBooking(bookingId: string): Booking {
    this.expireHolds();
    const booking = this.bookings.get(bookingId);
    if (!booking) raise('booking_not_found', 'The requested booking was not found.', false, { bookingId });
    return booking;
  }

  private isAvailable(id: string, excludeBookingId?: string): boolean {
    this.expireHolds();
    for (const booking of this.bookings.values()) {
      if (booking.availability_id !== id || booking.booking_id === excludeBookingId) continue;
      if (booking.status === 'held' || booking.status === 'confirmed') return false;
    }
    return true;
  }

  private expireHolds() {
    const now = this.now().getTime();
    for (const booking of this.bookings.values()) {
      if (booking.status === 'held' && booking.expires_at && Date.parse(booking.expires_at) <= now) {
        this.update(booking, { status: 'expired', expires_at: null });
      }
    }
  }

  private update(booking: Booking, changes: Partial<Booking>) {
    Object.assign(booking, changes, { updated_at: this.now().toISOString() });
  }

  /** The shared booking result, with the backend's summary wording. */
  private respond(booking: Booking): BookingResult {
    const name = DEMO_LISTINGS.find((listing) => listing.listing_id === booking.listing_id)?.name ?? booking.listing_id;
    const time = formatTime(booking.start_time);
    let summary: string;
    if (booking.status === 'held' && booking.expires_at) {
      summary = `${name} is held for ${booking.guest_name} at ${time} until ${formatTime(booking.expires_at)}.`;
    } else if (booking.status === 'confirmed') {
      summary = `Booking confirmed at ${name} for ${time}.`;
    } else if (booking.status === 'cancelled') {
      summary = `Booking at ${name} has been cancelled.`;
    } else {
      summary = `The booking hold at ${name} has expired.`;
    }
    return { booking: { ...booking }, summary };
  }
}
