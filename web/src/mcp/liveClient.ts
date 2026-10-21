import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { ToolArgs, ToolName, ToolOutputs } from '../contract/types';
import { errorText, LoggingTransport } from './loggingTransport';
import { CLIENT_ERROR_CODES, readToolResult, toolError, type CallToolResultLike } from './result';
import { CLIENT_INFO, PROTOCOL_VERSION, type LogSink, type ServerInfo, type ToolClient, type ToolOutcome } from './types';

/** The contract's local endpoint; override with VITE_MCP_URL in web/.env.local. */
export const DEFAULT_MCP_URL = 'http://127.0.0.1:8000/mcp';

export interface LiveClientOptions {
  /** Called after a dropped session was replaced by a new one. */
  onReconnected?(info: ServerInfo): void;
  /** Called when the server cannot be reached during a tool call. */
  onUnreachable?(message: string): void;
}

/** A fetch failure (server down, refused, blocked by CORS) rather than an answer from the server. */
function isUnreachable(error: unknown): boolean {
  const text = errorText(error);
  return error instanceof TypeError || /failed to fetch|networkerror|econnrefused|fetch failed|load failed/i.test(text);
}

/** The server no longer knows our session, e.g. after it restarted. */
function isSessionLost(error: unknown): boolean {
  const status = (error as { status?: unknown; code?: unknown } | null)?.status;
  return status === 404 || /session not found|unknown session|invalid session|\b404\b/i.test(errorText(error));
}

/**
 * Talks to the Python MCP server over Streamable HTTP with the official TypeScript SDK:
 * initialize (2025-11-25 handshake), tools/list, tools/call, keeping the Mcp-Session-Id.
 */
export class LiveClient implements ToolClient {
  readonly mode = 'live' as const;
  private client: Client | null = null;

  constructor(
    readonly endpoint: string,
    private readonly log: LogSink,
    private readonly options: LiveClientOptions = {},
  ) {}

  async connect(): Promise<ServerInfo> {
    await this.close();
    const transport = new StreamableHTTPClientTransport(new URL(this.endpoint));
    const logged = new LoggingTransport(transport, this.log);
    const client = new Client(CLIENT_INFO, { capabilities: {} });
    try {
      await client.connect(logged);
      const { tools } = await client.listTools();
      this.client = client;
      const server = client.getServerVersion();
      return {
        name: server?.name ?? 'MCP server',
        version: server?.version,
        protocolVersion: client.getNegotiatedProtocolVersion() ?? PROTOCOL_VERSION,
        sessionId: transport.sessionId,
        tools: tools.map((tool) => ({ name: tool.name, description: tool.description })),
      };
    } catch (error) {
      await client.close().catch(() => {});
      throw new Error(
        isUnreachable(error)
          ? `Can't reach the MCP server at ${this.endpoint}. Is it running?`
          : `The MCP server at ${this.endpoint} refused the connection: ${errorText(error)}`,
      );
    }
  }

  async callTool<N extends ToolName>(name: N, args: ToolArgs[N]): Promise<ToolOutcome<ToolOutputs[N]>> {
    if (!this.client) {
      return { ok: false, error: toolError('Not connected to the MCP server yet.', CLIENT_ERROR_CODES.unreachable) };
    }
    try {
      return await this.call(name, args);
    } catch (error) {
      if (isSessionLost(error)) {
        // The server forgot the session (it restarted): open a new one and try once more.
        try {
          const info = await this.connect();
          this.options.onReconnected?.(info);
          return await this.call(name, args);
        } catch (retryError) {
          return this.failed(retryError);
        }
      }
      return this.failed(error);
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    await client?.close().catch(() => {});
  }

  private async call<N extends ToolName>(name: N, args: ToolArgs[N]): Promise<ToolOutcome<ToolOutputs[N]>> {
    const result = await this.client!.callTool({ name, arguments: args as unknown as Record<string, unknown> });
    return readToolResult<ToolOutputs[N]>(result as CallToolResultLike);
  }

  private failed<T>(error: unknown): ToolOutcome<T> {
    if (isUnreachable(error)) {
      const message = `Can't reach the MCP server at ${this.endpoint}. Is it still running?`;
      this.options.onUnreachable?.(message);
      return { ok: false, error: toolError(message, CLIENT_ERROR_CODES.unreachable) };
    }
    return { ok: false, error: toolError(errorText(error), CLIENT_ERROR_CODES.protocol, { retryable: false }) };
  }
}
