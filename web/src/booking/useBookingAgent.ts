import { useMemo, useReducer, useRef, useState } from 'react';
import {
  DEMO_GUEST,
  type ModifyBookingInput,
  type ProviderType,
  type SearchAvailabilityInput,
  type SearchResult,
} from '../contract/types';
import * as replies from '../conversation/replies';
import { completeSearch, understand } from '../conversation/understand';
import { addMinutes, splitIso, toIsoDateTime } from '../lib/time';
import { ERROR_CODES } from '../mcp/result';
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
  hold(result: SearchResult): Promise<void>;
  confirm(): Promise<void>;
  release(): Promise<void>;
  modify(change: Change): Promise<void>;
  cancel(): Promise<void>;
  chooseAlternative(result: SearchResult): Promise<void>;
  showDetails(listingId: string): Promise<void>;
  closeDetails(): void;
  showBooking(): void;
  startOver(): void;
  expire(): void;
  setProvider(provider: ProviderType): void;
  retry(): void;
  dismissError(): void;
}

const minutesBetween = (start: string, end: string) => (new Date(end).getTime() - new Date(start).getTime()) / 60_000;

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

    /** A slot that is gone becomes a conflict with alternatives; anything else is an error. */
    async function settleFailure(
      during: 'hold' | 'confirm' | 'modify',
      error: ToolError,
      slot: SearchResult | null,
      searchInput: SearchAvailabilityInput | null,
    ) {
      const slotGone = error.code === ERROR_CODES.slotUnavailable || error.code === ERROR_CODES.holdExpired;
      if (!slotGone || !searchInput) {
        dispatch({ type: 'failed', message: error.message });
        say(replies.failed(error.message));
        return;
      }
      const found = await client.callTool('search_availability', searchInput);
      let alternatives = found.ok && Array.isArray(found.data.results) ? found.data.results : [];
      if (slot) {
        alternatives = alternatives.filter(
          (result) => !(result.listing_id === slot.listing_id && result.start_time === slot.start_time),
        );
        if (during === 'modify') alternatives = alternatives.filter((result) => result.listing_id === slot.listing_id);
      }
      alternatives = alternatives.slice(0, 2);
      dispatch({ type: 'conflict', conflict: { message: error.message, during, alternatives } });
      say(replies.conflict(error.message, alternatives));
    }

    async function search(input: SearchAvailabilityInput, assumed: Array<keyof SearchAvailabilityInput> = []) {
      const current = stateRef.current;
      if (current.busy) return say(replies.BUSY);
      lastStep.current = () => search(input, assumed);
      // A new search lets go of a hold that was never confirmed.
      if (current.booking?.record.status === 'held') {
        await client.callTool('cancel_booking', { booking_id: current.booking.record.booking_id });
      }
      dispatch({ type: 'search_started', search: input, assumed });
      const out = await client.callTool('search_availability', input);
      if (!out.ok) {
        dispatch({ type: 'failed', message: out.error.message });
        return say(replies.failed(out.error.message));
      }
      const results = Array.isArray(out.data.results) ? out.data.results : [];
      dispatch({ type: 'search_succeeded', results });
      say(replies.results(results, input));
    }

    async function hold(result: SearchResult) {
      const current = stateRef.current;
      if (current.busy) return say(replies.BUSY);
      lastStep.current = () => hold(result);
      const partySize = current.search?.party_size ?? 2;
      const guestNow = guestRef.current;
      dispatch({ type: 'started', task: 'hold' });
      const out = await client.callTool('create_booking_hold', {
        listing_id: result.listing_id,
        start_time: result.start_time,
        end_time: result.end_time,
        guest_name: guestNow.guest_name,
        guest_contact: guestNow.guest_contact,
        party_size: partySize,
      });
      if (!out.ok) return settleFailure('hold', out.error, result, current.search);
      dispatch({ type: 'held', booking: { record: out.data, slot: result, partySize, guest: guestNow } });
      say(replies.held(out.data, result));
    }

    async function confirm() {
      const current = stateRef.current;
      const booking = current.booking;
      if (!booking || !canConfirm(current)) {
        if (current.busy) return say(replies.BUSY);
        if (booking?.record.status === 'confirmed') return say(replies.ALREADY_CONFIRMED);
        if (booking?.record.status === 'expired') return say(replies.expired(booking.slot));
        return say(replies.NOTHING_TO_CONFIRM);
      }
      lastStep.current = confirm;
      dispatch({ type: 'started', task: 'confirm' });
      const out = await client.callTool('confirm_booking', { booking_id: booking.record.booking_id });
      if (!out.ok) return settleFailure('confirm', out.error, booking.slot, current.search);
      dispatch({ type: 'confirmed', record: out.data });
      say(out.data.summary);
    }

    async function release() {
      const current = stateRef.current;
      const booking = current.booking;
      if (current.busy) return say(replies.BUSY);
      if (!booking || current.view !== 'held') return say(replies.NOTHING_TO_CONFIRM);
      lastStep.current = release;
      dispatch({ type: 'started', task: 'cancel' });
      const out = await client.callTool('cancel_booking', { booking_id: booking.record.booking_id });
      if (!out.ok) {
        dispatch({ type: 'failed', message: out.error.message });
        return say(replies.failed(out.error.message));
      }
      dispatch({ type: 'cancelled', record: out.data });
      say(replies.RELEASED);
    }

    async function cancel() {
      const current = stateRef.current;
      const booking = current.booking;
      if (current.busy) return say(replies.BUSY);
      if (booking?.record.status === 'held') return release();
      if (booking?.record.status !== 'confirmed') return say(replies.NO_BOOKING);
      lastStep.current = cancel;
      dispatch({ type: 'started', task: 'cancel' });
      const out = await client.callTool('cancel_booking', { booking_id: booking.record.booking_id });
      if (!out.ok) {
        dispatch({ type: 'failed', message: out.error.message });
        return say(replies.failed(out.error.message));
      }
      dispatch({ type: 'cancelled', record: out.data });
      say(out.data.summary);
    }

    async function modify(change: Change) {
      const current = stateRef.current;
      const booking = current.booking;
      if (current.busy) return say(replies.BUSY);
      if (!booking || (booking.record.status !== 'confirmed' && booking.record.status !== 'held')) {
        return say(replies.NO_BOOKING);
      }
      const was = splitIso(booking.slot.start_time);
      const date = change.date ?? was.date;
      const time = change.time ?? was.time;
      const start = toIsoDateTime(date, time);
      const end = addMinutes(start, minutesBetween(booking.slot.start_time, booking.slot.end_time));
      const partySize = change.partySize ?? booking.partySize;
      const args: ModifyBookingInput = { booking_id: booking.record.booking_id };
      if (start !== booking.slot.start_time) Object.assign(args, { start_time: start, end_time: end });
      if (partySize !== booking.partySize) args.party_size = partySize;
      if (Object.keys(args).length === 1) return say(replies.NO_CHANGE);

      lastStep.current = () => modify(change);
      dispatch({ type: 'started', task: 'modify' });
      const out = await client.callTool('modify_booking', args);
      if (!out.ok) {
        const base = current.search ?? null;
        const searchInput = base && { ...base, date, time, party_size: partySize };
        return settleFailure('modify', out.error, booking.slot, searchInput);
      }
      dispatch({
        type: 'modified',
        record: out.data,
        slot: { ...booking.slot, start_time: start, end_time: end },
        partySize,
      });
      say(out.data.summary);
    }

    async function showDetails(listingId: string) {
      if (stateRef.current.busy) return say(replies.BUSY);
      dispatch({ type: 'details_started', listingId });
      const out = await client.callTool('get_listing_details', { listing_id: listingId });
      if (!out.ok) {
        dispatch({ type: 'failed', message: out.error.message });
        return say(replies.failed(out.error.message));
      }
      dispatch({ type: 'details_loaded', listingId, data: out.data });
    }

    function send(text: string) {
      const current = stateRef.current;
      add('user', text);
      if (current.busy) return say(replies.BUSY);
      const showingResults = current.view === 'results' ? current.results : [];
      const intent = understand(text, {
        now: nowRef.current(),
        resultNames: showingResults.map((result) => result.name),
        hasHold: current.view === 'held' && current.booking?.record.status === 'held',
        hasBooking: current.booking?.record.status === 'confirmed',
        holdExpired: current.view === 'held' && current.booking?.record.status === 'expired',
      });
      switch (intent.kind) {
        case 'search': {
          const { input, assumed } = completeSearch(intent.fields, current.provider, nowRef.current());
          void search(input, assumed);
          return;
        }
        case 'choose':
        case 'details': {
          const result = showingResults[intent.index];
          if (!result) return say(replies.noSuchOption(showingResults.length));
          void (intent.kind === 'choose' ? hold(result) : showDetails(result.listing_id));
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
      chooseAlternative: async (result: SearchResult) => {
        if (stateRef.current.conflict?.during === 'modify') {
          const { date, time } = splitIso(result.start_time);
          await modify({ date, time });
        } else {
          await hold(result);
        }
      },
      expire: () => {
        const booking = stateRef.current.booking;
        if (booking?.record.status !== 'held' || expiredIds.current.has(booking.record.booking_id)) return;
        expiredIds.current.add(booking.record.booking_id);
        dispatch({ type: 'hold_expired' });
        say(replies.expired(booking.slot));
      },
      closeDetails: () => dispatch({ type: 'details_closed' }),
      showBooking: () => dispatch({ type: 'booking_shown' }),
      startOver: () => dispatch({ type: 'reset' }),
      setProvider: (provider: ProviderType) => dispatch({ type: 'provider_changed', provider }),
      retry: () => {
        dispatch({ type: 'error_dismissed' });
        void lastStep.current?.();
      },
      dismissError: () => dispatch({ type: 'error_dismissed' }),
    };
  }, [client]);

  return { state, messages, guest, setGuest, ...actions };
}
