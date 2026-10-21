import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBookingAgent } from './booking/useBookingAgent';
import { ActivityLog } from './components/ActivityLog';
import { BookingPanel } from './components/BookingPanel';
import { ConversationPanel } from './components/Conversation';
import { StatusBanner } from './components/Feedback';
import { TopBar } from './components/TopBar';
import { suggestionsFor } from './conversation/suggestions';
import { useActivityLog } from './hooks/useActivityLog';
import { useSpeech } from './hooks/useSpeech';
import { DemoClient } from './mcp/demoClient';
import { DEFAULT_MCP_URL, LiveClient } from './mcp/liveClient';
import { errorText } from './mcp/loggingTransport';
import type { ClientMode, ConnectionState, ToolClient } from './mcp/types';

const params = new URLSearchParams(window.location.search);

/** `?mode=demo` answers from sample data in the browser; otherwise the page uses the MCP server. */
const MODE: ClientMode = params.get('mode') === 'demo' ? 'demo' : 'live';

/** Set VITE_MCP_URL in web/.env.local when the server is not on the contract's default address. */
const MCP_URL: string = import.meta.env.VITE_MCP_URL || DEFAULT_MCP_URL;

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
        locked={agent.state.busy !== null}
        connection={connection}
        endpoint={client.endpoint}
        onSwitchMode={switchMode}
        readAloud={readAloud}
        onReadAloud={setReadAloud}
      />
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
          busy={agent.state.busy}
          speaking={speaking}
          suggestions={suggestionsFor(agent.state)}
          onSend={agent.send}
          disabled={connection.status !== 'connected'}
        />
        <div className="side">
          <BookingPanel agent={agent} />
          <ActivityLog entries={activity.entries} connection={connection} onClear={activity.clear} />
        </div>
      </main>
    </div>
  );
}
