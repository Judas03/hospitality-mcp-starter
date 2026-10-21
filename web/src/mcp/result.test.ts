import { describe, expect, it } from 'vitest';
import { ERROR_CODES, readToolResult } from './result';

const text = (value: string) => [{ type: 'text', text: value }];

describe('readToolResult', () => {
  it('prefers structured content', () => {
    expect(readToolResult({ content: text('{}'), structuredContent: { results: [] } })).toEqual({
      ok: true,
      data: { results: [] },
      text: '{}',
    });
  });

  it('falls back to JSON in the text', () => {
    const out = readToolResult<{ status: string }>({ content: text('{"status":"ok"}') });
    expect(out.ok && out.data.status).toBe('ok');
  });

  it('uses an error code the server provides', () => {
    const out = readToolResult({
      isError: true,
      content: text('Nope'),
      structuredContent: { error: { code: 'slot_unavailable', message: 'Taken by someone else.' } },
    });
    expect(out).toEqual({ ok: false, error: { code: 'slot_unavailable', message: 'Taken by someone else.' } });
  });

  it('guesses the code from plain error text, as the server sends today', () => {
    const expired = readToolResult({ isError: true, content: text('Hold bk_1 expired at 7:02 PM.') });
    expect(!expired.ok && expired.error.code).toBe(ERROR_CODES.holdExpired);
    const unknownTool = readToolResult({ isError: true, content: text('Unknown tool: search_availability') });
    expect(!unknownTool.ok && unknownTool.error.code).toBe(ERROR_CODES.notFound);
  });

  it('reports a success it cannot read', () => {
    const out = readToolResult({ content: text('all good') });
    expect(!out.ok && out.error.code).toBe(ERROR_CODES.badResponse);
  });
});
