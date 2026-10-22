import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBookingAgent } from './booking/useBookingAgent';
import { ActivityLog } from './components/ActivityLog';
import { BookingPanel } from './components/BookingPanel';
import { ConversationPanel } from './components/Conversation';
import { StatusBanner } from './components/Feedback';
import { ItineraryPanel, PlanStrip } from './components/ItineraryPanel';
import { TopBar } from './components/TopBar';
import { suggestionsFor } from './conversation/suggestions';
import { useDemoScript } from './demo/useDemoScript';
import { useActivityLog } from './hooks/useActivityLog';
import { useSpeech } from './hooks/useSpeech';
import { useOccasionConcierge } from './itinerary/useOccasionConcierge';
import { DemoClient } from './mcp/demoClient';
import { DEFAULT_MCP_URL, LiveClient } from './mcp/liveClient';
import { errorText } from './mcp/loggingTransport';
import type { ClientMode, ConnectionState, LogEntry, ToolClient } from './mcp/types';

const params = new URLSearchParams(window.location.search);

/** `?mode=demo` answers from sample data in the browser; otherwise the page uses the MCP server. */
const MODE: ClientMode = params.get('mode') === 'demo' ? 'demo' : 'live';

/** Set VITE_MCP_URL in web/.env.local when the server is not on the contract's default address. */
const MCP_URL: string = import.meta.env.VITE_MCP_URL || DEFAULT_MCP_URL;

/** `?script=main` plays the scripted demo for the recording: one click per line. */
const SCRIPTED = params.get('script') === 'main';
const RIVAL = 'Another guest';

/** `?hold=20` shortens demo holds to 20 seconds, to show an expiry on a recording. */
function holdSecondsFromUrl(): number | undefined {
  const value = Number(params.get('hold'));
  return Number.isFinite(value) && value >= 5 && value <= 3600 ? value : undefined;
}

function switchMode(mode: ClientMode) {
  const next = new URLSearchParams(window.location.search);
  if (mode === 'demo') next.set('mode', 'demo');
  else next.delete('mode');
  window.location.search = next.toString();
}

export function App() {
  const activity = useActivityLog();
  const [connection, setConnection] = useState<ConnectionState>({ status: 'connecting', mode: MODE });
  const client = useMemo<ToolClient>(
    () =>
      MODE === 'demo'
        ? new DemoClient(activity.add, { holdSeconds: holdSecondsFromUrl() })
        : new LiveClient(MCP_URL, activity.add, {
            onReconnected: (info) => setConnection({ status: 'connected', mode: 'live', info }),
            onUnreachable: (message) => setConnection((state) => ({ ...state, status: 'error', message })),
          }),
    [activity.add],
  );
  const agent = useBookingAgent(client);

  // The scripted demo's other guest: a second session on the same server or demo data. Only its
  // tool calls go in the log, tagged so viewers can tell them apart.
  const logRival = useCallback(
    (entry: Omit<LogEntry, 'id'>) => {
      if (entry.method === 'tools/call') activity.add({ ...entry, actor: RIVAL });
    },
    [activity.add],
  );
  const rival = useMemo<ToolClient | null>(() => {
    if (!SCRIPTED) return null;
    return client instanceof DemoClient ? client.withLog(logRival) : new LiveClient(MCP_URL, logRival);
  }, [client, logRival]);
  const makeQuietClient = useMemo(() => (SCRIPTED && MODE === 'live' ? () => new LiveClient(MCP_URL, () => {}) : null), []);
  const script = useDemoScript({ enabled: SCRIPTED, agent, rival, makeQuietClient });
  // Every message goes through the concierge, which passes anything that isn't about a plan on to
  // the agent. Only one tool step runs at a time across both.
  const concierge = useOccasionConcierge(client, agent);
  const busy = agent.state.busy ?? concierge.task;
  // While scripting, the next line is the only chip; normal suggestions return once the script ends.
  let suggestions = concierge.suggestions ?? suggestionsFor(agent.state);
  if (SCRIPTED && script.nextLine) suggestions = [script.nextLine];
  else if (SCRIPTED && !script.ready) suggestions = [];

  const [readAloud, setReadAloud] = useState(false);
  const speaking = useSpeech(agent.messages, readAloud);

  const connect = useCallback(() => {
    setConnection({ status: 'connecting', mode: client.mode });
    client.connect().then(
      (info) => setConnection({ status: 'connected', mode: client.mode, info }),
      (error: unknown) => setConnection({ status: 'error', mode: client.mode, message: errorText(error) }),
    );
  }, [client]);

  // Connect once, even when React runs effects twice in development.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    connect();
  }, [connect]);

  return (
    <div className="app">
      <TopBar
        provider={agent.state.provider}
        onProvider={agent.setProvider}
        locked={busy !== null}
        connection={connection}
        endpoint={client.endpoint}
        onSwitchMode={SCRIPTED ? null : switchMode}
        readAloud={readAloud}
        onReadAloud={setReadAloud}
      />
      {MODE === 'demo' && (
        <p className="demo-strip" role="note">
          <strong>Demo mode.</strong> Answers come from sample data in this browser tab, with the same seven tools and
          rules as the live MCP server.
        </p>
      )}
      {connection.status === 'error' && (
        <StatusBanner
          message={connection.message ?? `Can't reach the MCP server at ${MCP_URL}.`}
          onRetry={connect}
          onUseDemo={() => switchMode('demo')}
        />
      )}
      <main className="layout">
        <ConversationPanel
          messages={agent.messages}
          busy={busy}
          speaking={speaking}
          suggestions={suggestions}
          onSend={concierge.send}
          onPick={(text) => (text === script.nextLine ? void script.playNext() : concierge.send(text))}
          chipsDisabled={script.playing}
          disabled={connection.status !== 'connected'}
        />
        <div className="side">
          {concierge.open ? (
            <ItineraryPanel concierge={concierge} blocked={agent.state.busy !== null} />
          ) : (
            <BookingPanel
              agent={agent}
              aside={
                concierge.plan?.phase === 'confirmed' && <PlanStrip plan={concierge.plan} onShow={concierge.show} />
              }
            />
          )}
          <ActivityLog entries={activity.entries} connection={connection} onClear={activity.clear} />
        </div>
      </main>
    </div>
  );
}
