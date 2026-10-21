import type { JSONRPCMessage, Transport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { LoggingTransport } from './loggingTransport';
import type { LogEntry } from './types';

class FakeTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId = 'session-1';
  sent: JSONRPCMessage[] = [];
  failNext = false;
  async start() {}
  async close() {}
  async send(message: JSONRPCMessage) {
    if (this.failNext) throw new TypeError('Failed to fetch');
    this.sent.push(message);
  }
  reply(message: unknown) {
    this.onmessage?.(message as JSONRPCMessage);
  }
}

function setup() {
  const inner = new FakeTransport();
  const log: Array<Omit<LogEntry, 'id'>> = [];
  const transport = new LoggingTransport(inner, (entry) => log.push(entry));
  const received: unknown[] = [];
  transport.onmessage = (message) => void received.push(message);
  return { inner, log, transport, received };
}

const call = (id: number, name: string) =>
  ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } }) as JSONRPCMessage;

describe('LoggingTransport', () => {
  it('pairs each request with its response and passes both through', async () => {
    const { inner, log, transport, received } = setup();
    await transport.send(call(7, 'search_availability'));
    expect(inner.sent).toHaveLength(1);
    expect(log).toHaveLength(0);
    const response = { jsonrpc: '2.0', id: 7, result: { content: [], structuredContent: { results: [] }, isError: false } };
    inner.reply(response);
    expect(received).toEqual([response]);
    expect(log).toEqual([
      expect.objectContaining({ mode: 'live', method: 'tools/call', tool: 'search_availability', ok: true, response }),
    ]);
    expect(transport.sessionId).toBe('session-1');
  });

  it('logs notifications once they are sent', async () => {
    const { log, transport } = setup();
    await transport.send({ jsonrpc: '2.0', method: 'notifications/initialized' } as JSONRPCMessage);
    expect(log).toEqual([expect.objectContaining({ method: 'notifications/initialized', ok: true })]);
  });

  it('marks a business error result as failed, with its code and message', async () => {
    const { inner, log, transport } = setup();
    await transport.send(call(8, 'create_booking_hold'));
    inner.reply({
      jsonrpc: '2.0',
      id: 8,
      result: {
        isError: true,
        structuredContent: { error: { code: 'slot_unavailable', message: 'That time is no longer available.' }, alternatives: [] },
      },
    });
    expect(log[0]).toMatchObject({ ok: false, errorMessage: 'slot_unavailable: That time is no longer available.' });
  });

  it('marks a JSON-RPC error as failed', async () => {
    const { inner, log, transport } = setup();
    await transport.send({ jsonrpc: '2.0', id: 9, method: 'tools/list' } as JSONRPCMessage);
    inner.reply({ jsonrpc: '2.0', id: 9, error: { code: -32602, message: 'Invalid params' } });
    expect(log[0]).toMatchObject({ method: 'tools/list', ok: false, errorMessage: 'Invalid params' });
  });

  it('logs a request that never reached the server, and still throws', async () => {
    const { inner, log, transport } = setup();
    inner.failNext = true;
    await expect(transport.send(call(10, 'get_booking'))).rejects.toThrow('Failed to fetch');
    expect(log[0]).toMatchObject({ tool: 'get_booking', ok: false, errorMessage: 'Failed to fetch' });
  });
});
