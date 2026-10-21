import { useCallback, useRef, useState } from 'react';
import type { LogEntry } from '../mcp/types';

const KEEP = 200;

/** The MCP activity log: every exchange a client reports, newest last. */
export function useActivityLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const nextId = useRef(1);
  const add = useCallback((entry: Omit<LogEntry, 'id'>) => {
    const id = nextId.current++;
    setEntries((list) => [...list, { ...entry, id }].slice(-KEEP));
  }, []);
  const clear = useCallback(() => setEntries([]), []);
  return { entries, add, clear };
}
