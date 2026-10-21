import { useEffect, useMemo, useRef, useState } from 'react';
import { useBookingAgent } from './booking/useBookingAgent';
import { ActivityLog } from './components/ActivityLog';
import { BookingPanel } from './components/BookingPanel';
import { ConversationPanel } from './components/Conversation';
import { TopBar } from './components/TopBar';
import { suggestionsFor } from './conversation/suggestions';
import { useActivityLog } from './hooks/useActivityLog';
import { useSpeech } from './hooks/useSpeech';
import { DemoClient } from './mcp/demoClient';
import type { ConnectionState } from './mcp/types';

/** `?hold=20` shortens demo holds to 20 seconds, to show an expiry on a recording. */
function holdSecondsFromUrl(): number | undefined {
  const value = Number(new URLSearchParams(window.location.search).get('hold'));
  return Number.isFinite(value) && value >= 5 && value <= 3600 ? value : undefined;
}

export function App() {
  const activity = useActivityLog();
  const client = useMemo(() => new DemoClient(activity.add, { holdSeconds: holdSecondsFromUrl() }), [activity.add]);
  const [connection, setConnection] = useState<ConnectionState>({ status: 'connecting', mode: client.mode });
  const agent = useBookingAgent(client);
  const [readAloud, setReadAloud] = useState(false);
  const speaking = useSpeech(agent.messages, readAloud);

  // Connect once, even when React runs effects twice in development.
  const connecting = useRef(false);
  useEffect(() => {
    if (connecting.current) return;
    connecting.current = true;
    client.connect().then(
      (info) => setConnection({ status: 'connected', mode: client.mode, info }),
      (error: unknown) =>
        setConnection({
          status: 'error',
          mode: client.mode,
          message: error instanceof Error ? error.message : String(error),
        }),
    );
  }, [client]);

  return (
    <div className="app">
      <TopBar
        provider={agent.state.provider}
        onProvider={agent.setProvider}
        locked={agent.state.busy !== null}
        connection={connection}
        readAloud={readAloud}
        onReadAloud={setReadAloud}
      />
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
