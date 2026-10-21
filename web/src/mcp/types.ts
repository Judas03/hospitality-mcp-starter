import type { Availability, BookingStatus, ToolArgs, ToolName, ToolOutputs } from '../contract/types';

/** "live" talks to the Python MCP server; "demo" answers from sample data in this browser tab. */
export type ClientMode = 'demo' | 'live';

export const CLIENT_INFO = { name: 'hospitality-mcp-web', version: '0.2.0' } as const;

/** The 2025-era handshake version the contract asks the browser to negotiate. */
export const PROTOCOL_VERSION = '2025-11-25';

export interface ToolInfo {
  name: string;
  description?: string;
}

export interface ServerInfo {
  name: string;
  version?: string;
  protocolVersion: string;
  sessionId?: string;
  tools: ToolInfo[];
}

export type LogMethod = 'initialize' | 'notifications/initialized' | 'tools/list' | 'tools/call' | (string & {});

/** One MCP exchange, as shown in the activity log. */
export interface LogEntry {
  id: number;
  /** Epoch milliseconds when the request was sent. */
  at: number;
  mode: ClientMode;
  /** Who made the call when it was not this page's guest, e.g. "Another guest" in the scripted demo. */
  actor?: string;
  method: LogMethod;
  tool?: string;
  request: unknown;
  response?: unknown;
  ok: boolean;
  durationMs: number;
  errorMessage?: string;
}

export type LogSink = (entry: Omit<LogEntry, 'id'>) => void;

export interface ToolError {
  /** A contract business code, a client code (see CLIENT_ERROR_CODES), or null if unknown. */
  code: string | null;
  message: string;
  retryable: boolean;
  /** Nearby options the server offered on a conflict. */
  alternatives: Availability[];
  currentStatus: BookingStatus | null;
}

export type ToolOutcome<T> = { ok: true; data: T } | { ok: false; error: ToolError };

export interface ConnectionState {
  status: 'connecting' | 'connected' | 'error';
  mode: ClientMode;
  info?: ServerInfo;
  message?: string;
}

/** What the page needs from an MCP connection; the live and demo clients both provide it. */
export interface ToolClient {
  readonly mode: ClientMode;
  /** Where it connects, for messages; null for demo data. */
  readonly endpoint: string | null;
  connect(): Promise<ServerInfo>;
  callTool<N extends ToolName>(name: N, args: ToolArgs[N]): Promise<ToolOutcome<ToolOutputs[N]>>;
  close(): Promise<void>;
}
