import type { ToolArgs, ToolName, ToolOutputs } from '../contract/types';
import type { ServerInfo, ToolClient, ToolError, ToolOutcome } from '../mcp/types';

// For tests: wraps a real client (demo or live), records every call in order, and can fail or
// act after a chosen call.

/**
 * `fail`: answer with this error instead of calling the server. `lose`: call the server, then answer
 * with this error, as when a request arrives but its answer never comes back. `after`: run once the
 * real call is done.
 */
export type Rule = { fail?: ToolError; lose?: ToolError; after?: () => void };

export class ScriptedClient implements ToolClient {
  readonly mode: ToolClient['mode'];
  readonly endpoint: string | null;
  readonly calls: Array<{ name: ToolName; args: unknown }> = [];
  /** Booking IDs of every hold the server created, in order. */
  readonly holds: string[] = [];
  private readonly rules = new Map<string, Rule>();
  private readonly counts = new Map<ToolName, number>();

  constructor(private readonly inner: ToolClient) {
    this.mode = inner.mode;
    this.endpoint = inner.endpoint;
  }

  /** What the nth call of this tool (counting from 1) does instead of, or after, the real call. */
  on(name: ToolName, nth: number, rule: Rule): this {
    this.rules.set(`${name}#${nth}`, rule);
    return this;
  }

  names(): ToolName[] {
    return this.calls.map((call) => call.name);
  }

  argsOf<N extends ToolName>(name: N): Array<ToolArgs[N]> {
    return this.calls.filter((call) => call.name === name).map((call) => call.args as ToolArgs[N]);
  }

  connect(): Promise<ServerInfo> {
    return this.inner.connect();
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  async callTool<N extends ToolName>(name: N, args: ToolArgs[N]): Promise<ToolOutcome<ToolOutputs[N]>> {
    this.calls.push({ name, args });
    const nth = (this.counts.get(name) ?? 0) + 1;
    this.counts.set(name, nth);
    const rule = this.rules.get(`${name}#${nth}`);
    if (rule?.fail) return { ok: false, error: rule.fail };
    const out = await this.inner.callTool(name, args);
    if (out.ok && name === 'create_booking_hold') this.holds.push((out.data as ToolOutputs['create_booking_hold']).booking.booking_id);
    rule?.after?.();
    return rule?.lose ? { ok: false, error: rule.lose } : out;
  }
}
