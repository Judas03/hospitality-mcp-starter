import { useCallback, useEffect, useRef, useState } from 'react';
import type { Agent } from '../booking/useBookingAgent';
import type { ToolClient } from '../mcp/types';
import { bestOption, MAIN_SCRIPT, RIVAL_GUEST } from './script';

// Bookings a take made on the live server, so the next take can free those slots first.
const STORAGE_KEY = 'hospitality-demo-script-bookings';

function remembered(): string[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function remember(ids: string[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    // Without storage, a retake just waits for the old holds to expire.
  }
}

export interface DemoScript {
  /** The only suggestion to offer while scripting; null when not scripting, not ready, or done. */
  nextLine: string | null;
  /** False while the last take's bookings are being cleared. */
  ready: boolean;
  /** True while a line is starting, e.g. while the other guest takes the slot. */
  playing: boolean;
  playNext(): Promise<void>;
}

interface Options {
  enabled: boolean;
  agent: Agent;
  /** A second guest on the same server or demo data. */
  rival: ToolClient | null;
  /** Makes an unlogged connection for clearing earlier takes; only on the live server. */
  makeQuietClient: (() => ToolClient) | null;
}

export function useDemoScript({ enabled, agent, rival, makeQuietClient }: Options): DemoScript {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(!enabled || !makeQuietClient);
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const playing = useRef(false);
  const [isPlaying, setPlaying] = useState(false);
  const rivalConnected = useRef(false);
  const cleared = useRef(false);

  // Free the slots an earlier take left booked on the live server, before the first line.
  useEffect(() => {
    if (!enabled || !makeQuietClient || cleared.current) return;
    cleared.current = true;
    const ids = remembered();
    if (ids.length === 0) {
      setReady(true);
      return;
    }
    const quiet = makeQuietClient();
    void (async () => {
      try {
        await quiet.connect();
        for (const booking_id of ids) await quiet.callTool('cancel_booking', { booking_id });
      } catch {
        // The server is down; the page's own connection error will say so.
      } finally {
        await quiet.close();
        remember([]);
        setReady(true);
      }
    })();
  }, [enabled, makeQuietClient]);

  const bookingId = agent.state.current?.booking.booking_id;
  useEffect(() => {
    if (enabled && makeQuietClient && bookingId) remember([...remembered(), bookingId]);
  }, [enabled, makeQuietClient, bookingId]);

  const line = enabled && ready && step < MAIN_SCRIPT.length ? MAIN_SCRIPT[step] : null;

  const playNext = useCallback(async () => {
    if (!line || playing.current) return;
    playing.current = true;
    setPlaying(true);
    try {
      if (line.rivalTakesBest && rival) {
        const { state } = agentRef.current;
        const target = bestOption(state.view === 'results' ? state.results : []);
        if (target) {
          try {
            if (!rivalConnected.current) {
              await rival.connect();
              rivalConnected.current = true;
            }
            const out = await rival.callTool('create_booking_hold', {
              availability_id: target.availability_id,
              party_size: target.party_size,
              ...RIVAL_GUEST,
            });
            if (out.ok && makeQuietClient) remember([...remembered(), out.data.booking.booking_id]);
          } catch {
            // Without the other guest the line still plays, just without the conflict.
          }
        }
      }
      setStep((current) => current + 1);
      agentRef.current.send(line.say);
    } finally {
      playing.current = false;
      setPlaying(false);
    }
  }, [line, rival, makeQuietClient]);

  return { nextLine: line?.say ?? null, ready, playing: isPlaying, playNext };
}
