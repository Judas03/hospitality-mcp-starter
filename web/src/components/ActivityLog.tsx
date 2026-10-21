import { useEffect, useRef } from 'react';
import { formatClock } from '../lib/time';
import type { ConnectionState, LogEntry as Entry } from '../mcp/types';

export function ActivityLog({
  entries,
  connection,
  onClear,
}: {
  entries: Entry[];
  connection: ConnectionState;
  onClear(): void;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries.length]);
  const info = connection.info;

  return (
    <section className="panel log" aria-labelledby="log-title">
      <div className="panel-head">
        <div>
          <h2 id="log-title">MCP activity</h2>
          <p className="panel-sub">
            {info ? `${info.name} · ${info.tools.length} tools` : 'Not connected yet'}
            {info?.sessionId && ` · session ${info.sessionId.slice(0, 8)}`}
          </p>
        </div>
        <div className="log-tools">
          <span className="count">{entries.length === 1 ? '1 message' : `${entries.length} messages`}</span>
          <button type="button" className="btn ghost small" onClick={onClear} disabled={entries.length === 0}>
            Clear
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="log-empty">Messages between this page and the MCP server appear here.</p>
      ) : (
        <ol className="log-list" ref={listRef}>
          {entries.map((entry) => (
            <LogEntry key={entry.id} entry={entry} />
          ))}
        </ol>
      )}
    </section>
  );
}

export function LogEntry({ entry }: { entry: Entry }) {
  return (
    <li className="log-entry" data-ok={entry.ok}>
      <details>
        <summary>
          <span className="log-time">{formatClock(entry.at)}</span>
          <span className="method">{entry.method}</span>
          {entry.tool && <span className="tool">{entry.tool}</span>}
          <span className="log-status" aria-label={entry.ok ? 'succeeded' : 'failed'}>
            {entry.ok ? '✓' : '✕'}
          </span>
          <span className="log-duration">{entry.durationMs} ms</span>
          {entry.mode === 'demo' && <span className="tag">demo</span>}
        </summary>
        {entry.errorMessage && <p className="log-error">{entry.errorMessage}</p>}
        <JsonViewer label="Request" value={entry.request} />
        {entry.response !== undefined && <JsonViewer label="Response" value={entry.response} />}
      </details>
    </li>
  );
}

export function JsonViewer({ label, value }: { label: string; value: unknown }) {
  return (
    <figure className="json">
      <figcaption>{label}</figcaption>
      <pre>
        <code>{JSON.stringify(value, null, 2)}</code>
      </pre>
    </figure>
  );
}
