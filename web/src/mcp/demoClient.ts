import {
  PROVIDER_TYPES,
  type Booking,
  type BookingRef,
  type CreateBookingHoldInput,
  type ListingDetails,
  type ModifyBookingInput,
  type SearchAvailabilityInput,
  type SearchResult,
  type ToolArgs,
  type ToolName,
  type ToolOutputs,
} from '../contract/types';
import { addDays, addMinutes, formatRange, formatTime, splitIso, toBangkokIso, toIsoDateTime } from '../lib/time';
import { CURRENCY, DEMO_LISTINGS, HOTEL_CHECK_OUT, RESTAURANT_TABLE_MINUTES, type DemoListing } from './demoData';
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

export const DEMO_TOOLS: ToolInfo[] = [
  { name: 'search_availability', description: 'Find open tables, appointments or rooms.' },
  { name: 'get_listing_details', description: 'Describe one restaurant, salon or hotel.' },
  { name: 'create_booking_hold', description: 'Hold a slot for a short time before it is confirmed.' },
  { name: 'confirm_booking', description: 'Confirm a held booking after the guest says yes.' },
  { name: 'modify_booking', description: 'Change the time or party size of a booking.' },
  { name: 'cancel_booking', description: 'Cancel a booking or release a hold.' },
  { name: 'get_booking', description: 'Read the current status of a booking.' },
];

export const DEMO_SERVER_NAME = 'Demo data (this browser tab)';

export interface DemoClientOptions {
  now?: () => Date;
  /** How long a hold lasts before it is released. */
  holdSeconds?: number;
  /** Pretend network time, so loading states are visible. */
  latencyMs?: number;
}

interface StoredBooking {
  booking_id: string;
  status: Booking['status'];
  expires_at?: string;
  listing: DemoListing;
  start_time: string;
  end_time: string;
  party_size: number;
  /** The salon service or hotel room type, when the listing has them. */
  option: string | null;
  guest_name: string;
  guest_contact: string;
}

const STATUS_LABELS: Record<string, string> = {
  held: 'On hold',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

/** Minutes to try around the asked-for time when it is taken. Hotels only use check-in time. */
const SHIFTS = [0, 30, -30, 60, -60];

const ok = (data: object): CallToolResultLike => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data,
  isError: false,
});

// Errors mirror what the Python server does today: isError with plain text only.
const fail = (message: string): CallToolResultLike => ({ content: [{ type: 'text', text: message }], isError: true });

const wait = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

function joinList(items: string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function menuOf(listing: DemoListing): Record<string, number> | null {
  if (listing.services) {
    return Object.fromEntries(Object.entries(listing.services).map(([name, service]) => [name, service.price]));
  }
  return listing.rooms ?? null;
}

/** The service or room a search is for: the one asked for, else the listing's first. Null if not offered. */
function pickOption(listing: DemoListing, wanted: string | null): { option: string | null; price: number } | null {
  const menu = menuOf(listing);
  if (!menu) return { option: null, price: 0 };
  const names = Object.keys(menu);
  const option = wanted ? names.find((name) => name === wanted.trim().toLowerCase()) : names[0];
  return option ? { option, price: menu[option] } : null;
}

function endFor(listing: DemoListing, start: string, option: string | null): string {
  if (listing.provider_type === 'hotel') return toIsoDateTime(addDays(splitIso(start).date, 1), HOTEL_CHECK_OUT);
  const minutes = listing.services && option ? listing.services[option].minutes : RESTAURANT_TABLE_MINUTES;
  return addMinutes(start, minutes);
}

function withinHours(listing: DemoListing, start: string, end: string): boolean {
  const from = splitIso(start);
  if (listing.provider_type === 'hotel') return from.time >= listing.opens;
  const to = splitIso(end);
  return from.date === to.date && from.time >= listing.opens && to.time <= listing.closes;
}

function describe(listing: DemoListing, option: string | null, party: number): string {
  if (listing.provider_type === 'hotel') return `${option} room for ${party}, 1 night`;
  if (listing.provider_type === 'salon') return `${option} for ${party}`;
  return `table for ${party}`;
}

function reasonFor(
  listing: DemoListing,
  wanted: string[],
  matched: string[],
  what: string,
  start: string,
  requested: string,
): string {
  const when = listing.provider_type === 'hotel' ? `, check-in ${formatTime(start)}` : ` free at ${formatTime(start)}`;
  const slot = start === requested ? `${what}${when}` : `${formatTime(requested)} is taken; ${what}${when}`;
  if (matched.length > 0) return `Matches ${joinList(matched)}; ${slot}`;
  if (wanted.length > 0) return `${slot[0].toUpperCase()}${slot.slice(1)}, but not listed as ${joinList(wanted)}`;
  return `${slot[0].toUpperCase()}${slot.slice(1)}`;
}

/**
 * Answers the contract's tools from sample data, entirely in the browser, so the page can be
 * built and recorded before the backend tools exist. Every exchange is logged as "demo".
 */
export class DemoClient implements ToolClient {
  readonly mode = 'demo' as const;
  private readonly now: () => Date;
  private readonly holdSeconds: number;
  private readonly latencyMs: number;
  private readonly bookings = new Map<string, StoredBooking>();
  /** The service or room offered for each listing and start time in a search, used by holds. */
  private readonly offered = new Map<string, string | null>();
  private nextBooking = 1001;

  constructor(
    private readonly log: LogSink,
    options: DemoClientOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.holdSeconds = options.holdSeconds ?? 120;
    this.latencyMs = options.latencyMs ?? 450;
  }

  async connect(): Promise<ServerInfo> {
    const serverInfo = { name: DEMO_SERVER_NAME, version: '0.1.0' };
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
    switch (name) {
      case 'search_availability':
        return this.search(args as SearchAvailabilityInput);
      case 'get_listing_details':
        return this.details((args as { listing_id: string }).listing_id);
      case 'create_booking_hold':
        return this.hold(args as CreateBookingHoldInput);
      case 'confirm_booking':
        return this.confirm(args as BookingRef);
      case 'modify_booking':
        return this.modify(args as ModifyBookingInput);
      case 'cancel_booking':
        return this.cancel(args as BookingRef);
      case 'get_booking':
        return this.read(args as BookingRef);
      default:
        return fail(`Unknown tool: ${String(name)}`);
    }
  }

  private search(input: SearchAvailabilityInput): CallToolResultLike {
    if (!PROVIDER_TYPES.includes(input.provider_type)) return fail('provider_type must be restaurant, salon or hotel.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
      return fail('date must be YYYY-MM-DD and time must be HH:MM.');
    }
    if (!(input.party_size >= 1)) return fail('party_size must be at least 1.');

    const wanted = input.preferences.map((preference) => preference.trim().toLowerCase()).filter(Boolean);
    const now = this.now().getTime();
    const found: Array<{ result: SearchResult; matched: number; shifted: boolean }> = [];

    for (const listing of DEMO_LISTINGS) {
      if (listing.provider_type !== input.provider_type) continue;
      if (listing.location.toLowerCase() !== input.location.trim().toLowerCase()) continue;
      if (input.party_size > listing.max_party) continue;
      const wantedOption =
        listing.provider_type === 'salon' ? input.service_type : listing.provider_type === 'hotel' ? input.room_type : null;
      const pick = pickOption(listing, wantedOption);
      if (!pick) continue;

      const askedTime = listing.provider_type === 'hotel' && input.time < listing.opens ? listing.opens : input.time;
      const requested = toIsoDateTime(input.date, askedTime);
      const shifts = listing.provider_type === 'hotel' ? [0] : SHIFTS;
      let start: string | null = null;
      let end = '';
      for (const shift of shifts) {
        const candidate = addMinutes(requested, shift);
        const candidateEnd = endFor(listing, candidate, pick.option);
        if (new Date(candidate).getTime() <= now) continue;
        if (withinHours(listing, candidate, candidateEnd) && this.isFree(listing.listing_id, candidate)) {
          start = candidate;
          end = candidateEnd;
          break;
        }
      }
      if (!start) continue;

      const matched = wanted.filter((preference) => listing.features.includes(preference));
      this.offered.set(`${listing.listing_id}|${start}`, pick.option);
      found.push({
        matched: matched.length,
        shifted: start !== requested,
        result: {
          listing_id: listing.listing_id,
          name: listing.name,
          provider_type: listing.provider_type,
          location: listing.location,
          start_time: start,
          end_time: end,
          price: pick.price,
          currency: CURRENCY,
          reason: reasonFor(listing, wanted, matched, describe(listing, pick.option, input.party_size), start, requested),
        },
      });
    }

    found.sort((a, b) => b.matched - a.matched || Number(a.shifted) - Number(b.shifted));
    return ok({ results: found.slice(0, 3).map((entry) => entry.result) });
  }

  private details(listingId: string): CallToolResultLike {
    const listing = DEMO_LISTINGS.find((candidate) => candidate.listing_id === listingId);
    if (!listing) return fail(`Listing ${listingId} not found.`);
    const details: ListingDetails = {
      listing_id: listing.listing_id,
      name: listing.name,
      provider_type: listing.provider_type,
      location: listing.location,
      area: listing.area,
      description: listing.description,
      features: listing.features,
      max_party_size: listing.max_party,
      ...(listing.provider_type === 'hotel'
        ? { check_in_from: listing.opens, check_out_by: HOTEL_CHECK_OUT }
        : { opening_hours: `${listing.opens}–${listing.closes}` }),
      ...(listing.services && {
        services: Object.entries(listing.services).map(([name, s]) => `${name}: ${s.minutes} min, ${s.price} ${CURRENCY}`),
      }),
      ...(listing.rooms && {
        rooms: Object.entries(listing.rooms).map(([name, price]) => `${name}: ${price} ${CURRENCY} per night`),
      }),
    };
    return ok(details);
  }

  private hold(input: CreateBookingHoldInput): CallToolResultLike {
    const listing = DEMO_LISTINGS.find((candidate) => candidate.listing_id === input.listing_id);
    if (!listing) return fail(`Listing ${input.listing_id} not found.`);
    if (!input.guest_name?.trim() || !input.guest_contact?.trim()) return fail('guest_name and guest_contact are required.');
    if (!(input.party_size >= 1) || input.party_size > listing.max_party) {
      return fail(`party_size must be between 1 and ${listing.max_party} at ${listing.name}.`);
    }
    if (!withinHours(listing, input.start_time, input.end_time)) {
      return fail(`That time is unavailable: ${listing.name} is closed then.`);
    }
    if (!this.isFree(listing.listing_id, input.start_time)) {
      return fail(`That time is no longer available at ${listing.name}.`);
    }
    const key = `${listing.listing_id}|${input.start_time}`;
    const booking: StoredBooking = {
      booking_id: `bk_${this.nextBooking++}`,
      status: 'held',
      expires_at: toBangkokIso(this.now().getTime() + this.holdSeconds * 1000),
      listing,
      start_time: input.start_time,
      end_time: input.end_time,
      party_size: input.party_size,
      option: this.offered.has(key) ? this.offered.get(key)! : (pickOption(listing, null)?.option ?? null),
      guest_name: input.guest_name,
      guest_contact: input.guest_contact,
    };
    this.bookings.set(booking.booking_id, booking);
    return ok(this.record(booking));
  }

  private confirm({ booking_id }: BookingRef): CallToolResultLike {
    const booking = this.find(booking_id);
    if (!booking) return fail(`Booking ${booking_id} not found.`);
    if (booking.status === 'confirmed') return ok(this.record(booking, 'Already confirmed'));
    if (booking.status === 'expired') {
      return fail(`Hold ${booking_id} expired at ${formatTime(booking.expires_at!)} and was released.`);
    }
    if (booking.status === 'cancelled') return fail(`Booking ${booking_id} was cancelled, so it cannot be confirmed.`);
    booking.status = 'confirmed';
    return ok(this.record(booking));
  }

  private modify(input: ModifyBookingInput): CallToolResultLike {
    const booking = this.find(input.booking_id);
    if (!booking) return fail(`Booking ${input.booking_id} not found.`);
    if (booking.status !== 'held' && booking.status !== 'confirmed') {
      return fail(`Booking ${input.booking_id} is ${booking.status} and can no longer be changed.`);
    }
    const { listing } = booking;
    const minutes = (new Date(booking.end_time).getTime() - new Date(booking.start_time).getTime()) / 60_000;
    const start = input.start_time ?? booking.start_time;
    const end = input.end_time ?? (input.start_time ? addMinutes(start, minutes) : booking.end_time);
    const party = input.party_size ?? booking.party_size;
    if (!(party >= 1) || party > listing.max_party) {
      return fail(`party_size must be between 1 and ${listing.max_party} at ${listing.name}.`);
    }
    if (!withinHours(listing, start, end)) return fail(`That time is unavailable: ${listing.name} is closed then.`);
    if (!this.isFree(listing.listing_id, start, booking.booking_id)) {
      return fail(`That time is no longer available at ${listing.name}.`);
    }
    Object.assign(booking, { start_time: start, end_time: end, party_size: party });
    return ok(this.record(booking, 'Changed'));
  }

  private cancel({ booking_id }: BookingRef): CallToolResultLike {
    const booking = this.find(booking_id);
    if (!booking) return fail(`Booking ${booking_id} not found.`);
    if (booking.status === 'cancelled') return ok(this.record(booking, 'Already cancelled'));
    if (booking.status === 'expired') return ok(this.record(booking, 'Already released'));
    const label = booking.status === 'held' ? 'Released' : 'Cancelled';
    booking.status = 'cancelled';
    return ok(this.record(booking, label));
  }

  private read({ booking_id }: BookingRef): CallToolResultLike {
    const booking = this.find(booking_id);
    return booking ? ok(this.record(booking)) : fail(`Booking ${booking_id} not found.`);
  }

  /** Look a booking up, releasing it first if its hold has run out. */
  private find(bookingId: string): StoredBooking | undefined {
    const booking = this.bookings.get(bookingId);
    if (booking?.status === 'held' && new Date(booking.expires_at!).getTime() <= this.now().getTime()) {
      booking.status = 'expired';
    }
    return booking;
  }

  /** Each listing has one bookable slot per start time (the 7:00 seating, the 7:30 seating, ...). */
  private isFree(listingId: string, start: string, ignoreId?: string): boolean {
    const from = new Date(start).getTime();
    for (const booking of this.bookings.values()) {
      if (booking.listing.listing_id !== listingId || booking.booking_id === ignoreId) continue;
      const current = this.find(booking.booking_id)!;
      if (current.status !== 'held' && current.status !== 'confirmed') continue;
      if (new Date(current.start_time).getTime() === from) return false;
    }
    return true;
  }

  private record(booking: StoredBooking, label?: string): Booking {
    const what = `${describe(booking.listing, booking.option, booking.party_size)} at ${booking.listing.name}`;
    const when = formatRange(booking.start_time, booking.end_time);
    const prefix = label ?? STATUS_LABELS[booking.status] ?? booking.status;
    let summary = `${prefix}: ${what}, ${when}.`;
    if (booking.status === 'held') summary += ` Confirm by ${formatTime(booking.expires_at!)} or it is released.`;
    if (booking.status === 'confirmed') summary += ` Reference ${booking.booking_id}.`;
    return {
      booking_id: booking.booking_id,
      status: booking.status,
      ...(booking.status === 'held' && { expires_at: booking.expires_at }),
      summary,
    };
  }
}
