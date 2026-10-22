import { useMemo, useReducer, useRef, useState } from 'react';
import {
  DEMO_GUEST,
  type Availability,
  type ModifyBookingInput,
  type ProviderType,
  type SearchAvailabilityInput,
} from '../contract/types';
import * as replies from '../conversation/replies';
import { completeSearch, understand } from '../conversation/understand';
import { findSlotAt, groupByPlace } from '../lib/places';
import { splitIso, toIsoDateTime } from '../lib/time';
import type { ToolClient, ToolError } from '../mcp/types';
import { canConfirm, flowReducer, initialFlow, type FlowState, type Guest } from './flow';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  text: string;
}

export interface Change {
  date?: string;
  time?: string;
  partySize?: number;
}

export interface Agent {
  state: FlowState;
  messages: ChatMessage[];
  guest: Guest;
  setGuest(guest: Guest): void;
  send(text: string): void;
  search(input: SearchAvailabilityInput, assumed?: Array<keyof SearchAvailabilityInput>): Promise<void>;
  searchAgain(): Promise<void>;
  hold(slot: Availability): Promise<void>;
  confirm(): Promise<void>;
  release(): Promise<void>;
  modify(change: Change): Promise<void>;
  cancel(): Promise<void>;
  chooseAlternative(slot: Availability): Promise<void>;
  showDetails(listingId: string): Promise<void>;
  closeDetails(): void;
  showBooking(): void;
  startOver(): void;
  expire(): void;
  setProvider(provider: ProviderType): void;
  retry(): void;
  dismissError(): void;
  /** Adds a message to the conversation, for requests another flow (the concierge) answers. */
  addMessage(role: ChatMessage['role'], text: string): void;
  /**
   * Lets go of an unconfirmed hold before another flow starts, and resolves to whether the server
   * shows it gone (or there was none). A confirmed booking is never touched.
   */
  releaseHold(): Promise<boolean>;
}

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

/** Runs the conversation: reads each request, calls the MCP tools, and keeps the booking steps. */
export function useBookingAgent(client: ToolClient, now: () => Date = () => new Date()): Agent {
  const [state, dispatch] = useReducer(flowReducer, undefined, () => initialFlow());
  const [messages, setMessages] = useState<ChatMessage[]>([{ id: 0, role: 'assistant', text: replies.GREETING }]);
  const [guest, setGuest] = useState<Guest>({ ...DEMO_GUEST });

  // Async steps read the latest values through refs rather than stale closures.
  const stateRef = useRef(state);
  stateRef.current = state;
  const guestRef = useRef(guest);
  guestRef.current = guest;
  const nowRef = useRef(now);
  nowRef.current = now;
  const nextId = useRef(1);
  const lastStep = useRef<(() => Promise<void>) | null>(null);
  const expiredIds = useRef(new Set<string>());

  const actions = useMemo(() => {
    const add = (role: ChatMessage['role'], text: string) =>
      setMessages((list) => [...list, { id: nextId.current++, role, text }]);
    const say = (text: string) => add('assistant', text);

    const fail = (error: ToolError) => {
      dispatch({ type: 'failed', message: error.message });
      say(replies.failed(error.message));
    };

    /** An option that is gone becomes a conflict showing the server's alternatives. */
    function settle(during: 'hold' | 'confirm' | 'modify', error: ToolError) {
      if (error.code === 'slot_unavailable') {
        dispatch({ type: 'conflict', conflict: { message: error.message, during, alternatives: error.alternatives } });
        return say(replies.conflict(error.message, error.alternatives));
      }
      if (error.code === 'hold_expired') {
        dispatch({ type: 'hold_expired' });
        const name = stateRef.current.current?.slot.name;
        return say(name ? replies.expired(name) : error.message);
      }
      fail(error);
    }

    async function search(input: SearchAvailabilityInput, assumed: Array<keyof SearchAvailabilityInput> = []) {
      const current = stateRef.current;
      if (current.busy) return say(replies.BUSY);
      lastStep.current = () => search(input, assumed);
      // A new search lets go of a hold that was never confirmed.
      if (current.current?.booking.status === 'held') {
        await client.callTool('cancel_booking', { booking_id: current.current.booking.booking_id });
      }
      dispatch({ type: 'search_started', search: input, assumed });
      const out = await client.callTool('search_availability', input);
      if (!out.ok) return fail(out.error);
      const results = Array.isArray(out.data.results) ? out.data.results : [];
      dispatch({ type: 'search_succeeded', results });
      say(replies.results(results, input));
    }

    async function hold(slot: Availability) {
      const current = stateRef.current;
      if (current.busy) return say(replies.BUSY);
      lastStep.current = () => hold(slot);
      const guestNow = guestRef.current;
      dispatch({ type: 'started', task: 'hold' });
      const out = await client.callTool('create_booking_hold', {
        availability_id: slot.availability_id,
        guest_name: guestNow.guest_name,
        guest_contact: guestNow.guest_contact,
        party_size: slot.party_size,
      });
      if (!out.ok) return settle('hold', out.error);
      dispatch({ type: 'held', result: out.data, slot });
      say(replies.held(out.data));
    }

    async function confirm() {
      const current = stateRef.current;
      const booking = current.current?.booking;
      if (!booking || !canConfirm(current)) {
        if (current.busy) return say(replies.BUSY);
        if (booking?.status === 'confirmed') return say(replies.ALREADY_CONFIRMED);
        if (booking?.status === 'expired') return say(replies.expired(current.current!.slot.name));
        return say(replies.NOTHING_TO_CONFIRM);
      }
      lastStep.current = confirm;
      dispatch({ type: 'started', task: 'confirm' });
      // Only ever sent from the guest's own yes or Confirm click.
      const out = await client.callTool('confirm_booking', { booking_id: booking.booking_id, user_confirmed: true });
      if (!out.ok) return settle('confirm', out.error);
      dispatch({ type: 'confirmed', result: out.data });
      say(out.data.summary);
    }

    async function cancelBooking(released: boolean) {
      const booking = stateRef.current.current!.booking;
      lastStep.current = released ? release : cancel;
      dispatch({ type: 'started', task: 'cancel' });
      const out = await client.callTool('cancel_booking', { booking_id: booking.booking_id });
      if (!out.ok) return fail(out.error);
      dispatch({ type: 'cancelled', result: out.data });
      say(released ? replies.RELEASED : out.data.summary);
    }

    async function release() {
      const current = stateRef.current;
      if (current.busy) return say(replies.BUSY);
      if (current.view !== 'held' || current.current?.booking.status !== 'held') return say(replies.NOTHING_TO_CONFIRM);
      await cancelBooking(true);
    }

    async function cancel() {
      const current = stateRef.current;
      if (current.busy) return say(replies.BUSY);
      const status = current.current?.booking.status;
      if (status === 'held') return release();
      if (status !== 'confirmed') return say(replies.NO_BOOKING);
      await cancelBooking(false);
    }

    async function releaseHold(): Promise<boolean> {
      const current = stateRef.current;
      if (current.busy) return false;
      const booking = current.current?.booking;
      if (booking?.status !== 'held') return true;
      dispatch({ type: 'started', task: 'cancel' });
      const out = await client.callTool('cancel_booking', { booking_id: booking.booking_id });
      // Released only when the server says so: cancelled, or expired in the meantime.
      const check = await client.callTool('get_booking', { booking_id: booking.booking_id });
      if (check.ok && (check.data.booking.status === 'cancelled' || check.data.booking.status === 'expired')) {
        dispatch({ type: 'cancelled', result: check.data });
        return true;
      }
      const reason = !out.ok ? out.error.message : !check.ok ? check.error.message : replies.NOT_RELEASED;
      dispatch({ type: 'failed', message: reason });
      return false;
    }

    /**
     * A new time means searching again and passing the matching availability_id, as the
     * contract asks; a new party size alone goes straight to modify_booking.
     */
    async function modify(change: Change) {
      const current = stateRef.current;
      const active = current.current;
      if (current.busy) return say(replies.BUSY);
      if (!active || (active.booking.status !== 'confirmed' && active.booking.status !== 'held')) {
        return say(replies.NO_BOOKING);
      }
      const { booking, slot } = active;
      const was = splitIso(booking.start_time);
      const date = change.date ?? was.date;
      const time = change.time ?? was.time;
      const partySize = change.partySize ?? booking.party_size;
      const moving = !sameInstant(toIsoDateTime(date, time), booking.start_time);
      if (!moving && partySize === booking.party_size) return say(replies.NO_CHANGE);

      lastStep.current = () => modify(change);
      dispatch({ type: 'started', task: 'modify' });
      const args: ModifyBookingInput = { booking_id: booking.booking_id };
      if (partySize !== booking.party_size) args.party_size = partySize;
      let target = slot;
      if (moving) {
        const found = await client.callTool('search_availability', {
          provider_type: booking.provider_type,
          location: slot.location,
          date,
          time,
          party_size: partySize,
          service_type: booking.service_type,
          room_type: booking.room_type,
          preferences: [],
        });
        if (!found.ok) return fail(found.error);
        const samePlace = found.data.results.filter((result) => result.listing_id === booking.listing_id);
        const match = samePlace.find((result) => sameInstant(result.start_time, toIsoDateTime(date, time)));
        if (!match) {
          const alternatives = samePlace.filter((result) => result.availability_id !== booking.availability_id).slice(0, 2);
          const message = replies.notFreeThen(slot.name, time);
          dispatch({ type: 'conflict', conflict: { message, during: 'modify', alternatives } });
          return say(replies.conflict(message, alternatives));
        }
        args.new_availability_id = match.availability_id;
        target = match;
      }
      const out = await client.callTool('modify_booking', args);
      if (!out.ok) return settle('modify', out.error);
      dispatch({ type: 'modified', result: out.data, slot: { ...target, party_size: out.data.booking.party_size } });
      say(replies.changed(out.data));
    }

    async function showDetails(listingId: string) {
      if (stateRef.current.busy) return say(replies.BUSY);
      dispatch({ type: 'details_started', listingId });
      const out = await client.callTool('get_listing_details', { listing_id: listingId });
      if (!out.ok) return fail(out.error);
      dispatch({ type: 'details_loaded', listingId, listing: out.data.listing });
      say(replies.details(out.data.listing));
    }

    /** The countdown reached zero: ask the server for the booking, which applies the expiry. */
    async function expire() {
      const active = stateRef.current.current;
      if (active?.booking.status !== 'held' || expiredIds.current.has(active.booking.booking_id)) return;
      expiredIds.current.add(active.booking.booking_id);
      const out = await client.callTool('get_booking', { booking_id: active.booking.booking_id });
      if (out.ok && out.data.booking.status !== 'held') dispatch({ type: 'synced', result: out.data });
      else dispatch({ type: 'hold_expired' });
      say(replies.expired(active.slot.name));
    }

    function choose(index: number | null, time?: string) {
      const current = stateRef.current;
      const places = groupByPlace(current.view === 'results' ? current.results : []);
      if (index !== null && !places[index]) return say(replies.noSuchOption(places.length));
      const candidates = index !== null ? places[index].slots : places.flatMap((place) => place.slots);
      const slot = time ? findSlotAt(candidates, time) : candidates[0];
      if (!slot) return say(replies.noSuchTime(time ?? ''));
      void hold(slot);
    }

    function send(text: string) {
      const current = stateRef.current;
      add('user', text);
      if (current.busy) return say(replies.BUSY);
      const places = groupByPlace(current.view === 'results' ? current.results : []);
      const intent = understand(text, {
        now: nowRef.current(),
        resultNames: places.map((place) => place.name),
        resultsProvider: current.search?.provider_type,
        hasHold: current.view === 'held' && current.current?.booking.status === 'held',
        hasBooking: current.current?.booking.status === 'confirmed',
        holdExpired: current.view === 'held' && current.current?.booking.status === 'expired',
      });
      switch (intent.kind) {
        case 'search': {
          const { input, assumed } = completeSearch(intent.fields, current.provider, nowRef.current());
          void search(input, assumed);
          return;
        }
        case 'choose':
          return choose(intent.index, intent.time);
        case 'details': {
          const place = places[intent.index];
          if (!place) return say(replies.noSuchOption(places.length));
          void showDetails(place.listing_id);
          return;
        }
        case 'confirm':
          void confirm();
          return;
        case 'decline':
          void release();
          return;
        case 'modify':
          void modify(intent);
          return;
        case 'cancel':
          void cancel();
          return;
        case 'search_again':
          if (current.search) void search(current.search, current.assumed);
          return;
        case 'help':
          return say(replies.HELP);
        case 'unknown':
          return say(replies.UNKNOWN);
      }
    }

    return {
      send,
      search,
      hold,
      confirm,
      release,
      modify,
      cancel,
      showDetails,
      searchAgain: async () => {
        const { search: last, assumed } = stateRef.current;
        if (last) await search(last, assumed);
      },
      chooseAlternative: async (slot: Availability) => {
        if (stateRef.current.conflict?.during === 'modify') {
          const { date, time } = splitIso(slot.start_time);
          await modify({ date, time });
        } else {
          await hold(slot);
        }
      },
      expire: () => void expire(),
      closeDetails: () => dispatch({ type: 'details_closed' }),
      showBooking: () => dispatch({ type: 'booking_shown' }),
      startOver: () => dispatch({ type: 'reset' }),
      setProvider: (provider: ProviderType) => dispatch({ type: 'provider_changed', provider }),
      retry: () => {
        dispatch({ type: 'error_dismissed' });
        void lastStep.current?.();
      },
      dismissError: () => dispatch({ type: 'error_dismissed' }),
      addMessage: add,
      releaseHold,
    };
  }, [client]);

  return { state, messages, guest, setGuest, ...actions };
}
