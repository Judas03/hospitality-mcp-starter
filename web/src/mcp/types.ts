import type { ToolArgs, ToolName, ToolOutputs } from '../contract/types';

/** "live" talks to the Python MCP server; "demo" answers from sample data in this browser tab. */
export type ClientMode = 'demo' | 'live';

export const CLIENT_INFO = { name: 'hospitality-mcp-web', version: '0.1.0' } as const;

/** The 2025-era handshake version the hackathon asks for; the live server may agree on another. */
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

export type LogMethod = 'initialize' | 'notifications/initialized' | 'tools/list' | 'tools/call';

/** One MCP exchange, as shown in the activity log. */
export interface LogEntry {
  id: number;
  /** Epoch milliseconds when the request was sent. */
  at: number;
  mode: ClientMode;
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
  /** Known codes: see ERROR_CODES in result.ts. Null when the server's text gave no clue. */
  code: string | null;
  message: string;
}

export interface ConnectionState {
  status: 'connecting' | 'connected' | 'error';
  mode: ClientMode;
  info?: ServerInfo;
  message?: string;
}

export type ToolOutcome<T> = { ok: true; data: T; text: string } | { ok: false; error: ToolError };

/** What the page needs from an MCP connection; the live and demo clients both provide it. */
export interface ToolClient {
  readonly mode: ClientMode;
  connect(): Promise<ServerInfo>;
  callTool<N extends ToolName>(name: N, args: ToolArgs[N]): Promise<ToolOutcome<ToolOutputs[N]>>;
  close(): Promise<void>;
}
