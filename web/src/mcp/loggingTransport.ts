import type { JSONRPCMessage, MessageExtraInfo, Transport, TransportSendOptions } from '@modelcontextprotocol/client';
import type { ClientMode, LogSink } from './types';

interface Pending {
  at: number;
  method: string;
  tool?: string;
  request: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

function toolNameOf(message: Record<string, unknown>): string | undefined {
  const params = message.params;
  return message.method === 'tools/call' && isObject(params) && typeof params.name === 'string' ? params.name : undefined;
}

/**
 * Wraps a real MCP transport and reports every JSON-RPC message to the activity log as it goes
 * over the wire: each request paired with its response, notifications on their own.
 */
export class LoggingTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;
  private readonly pending = new Map<string | number, Pending>();

  constructor(
    private readonly inner: Transport,
    private readonly log: LogSink,
    private readonly mode: ClientMode = 'live',
  ) {
    inner.onmessage = (message, extra) => {
      this.received(message);
      this.onmessage?.(message, extra);
    };
    inner.onclose = () => this.onclose?.();
    inner.onerror = (error) => this.onerror?.(error);
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  get hasPerRequestStream(): boolean | undefined {
    return this.inner.hasPerRequestStream;
  }

  setProtocolVersion = (version: string) => this.inner.setProtocolVersion?.(version);
  setSupportedProtocolVersions = (versions: string[]) => this.inner.setSupportedProtocolVersions?.(versions);

  start(): Promise<void> {
    return this.inner.start();
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    const at = Date.now();
    const record = message as unknown as Record<string, unknown>;
    const method = typeof record.method === 'string' ? record.method : undefined;
    const id = record.id as string | number | undefined;
    if (method && id !== undefined) this.pending.set(id, { at, method, tool: toolNameOf(record), request: message });
    try {
      await this.inner.send(message, options);
    } catch (error) {
      if (id !== undefined) this.pending.delete(id);
      this.report(method ?? 'message', toolNameOf(record), message, undefined, at, false, errorText(error));
      throw error;
    }
    // Notifications get no reply, so they are logged once the server has accepted them.
    if (method && id === undefined) this.report(method, undefined, message, undefined, at, true);
  }

  private received(message: JSONRPCMessage) {
    const record = message as unknown as Record<string, unknown>;
    const id = record.id as string | number | undefined;
    const pending = id !== undefined ? this.pending.get(id) : undefined;
    if (!pending) return;
    this.pending.delete(id!);
    const result = record.result;
    const rpcError = isObject(record.error) ? record.error : undefined;
    const toolFailed = isObject(result) && result.isError === true;
    const errorMessage = rpcError
      ? String(rpcError.message ?? 'JSON-RPC error')
      : toolFailed
        ? failureText(result)
        : undefined;
    this.report(pending.method, pending.tool, pending.request, message, pending.at, !rpcError && !toolFailed, errorMessage);
  }

  private report(
    method: string,
    tool: string | undefined,
    request: unknown,
    response: unknown,
    at: number,
    ok: boolean,
    errorMessage?: string,
  ) {
    this.log({ at, mode: this.mode, method, tool, request, response, ok, durationMs: Date.now() - at, errorMessage });
  }
}

function failureText(result: Record<string, unknown>): string {
  const structured = result.structuredContent;
  if (isObject(structured) && isObject(structured.error) && typeof structured.error.message === 'string') {
    return `${String(structured.error.code)}: ${structured.error.message}`;
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const first = content.find((part) => isObject(part) && typeof part.text === 'string') as { text?: string } | undefined;
  return first?.text ?? 'The tool reported an error.';
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
