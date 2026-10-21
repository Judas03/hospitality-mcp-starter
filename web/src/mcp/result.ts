import type { ToolOutcome } from './types';

/** The parts of an MCP CallToolResult the page reads. */
export interface CallToolResultLike {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export const ERROR_CODES = {
  slotUnavailable: 'slot_unavailable',
  holdExpired: 'hold_expired',
  notFound: 'not_found',
  invalidInput: 'invalid_input',
  badResponse: 'bad_response',
} as const;

// The contract has no error format yet: today a failing tool returns isError with plain
// text only. Read a code from structured content if the backend adds one, else guess from text.
const TEXT_CLUES: Array<[RegExp, string]> = [
  [/expired|ran out/i, ERROR_CODES.holdExpired],
  [/unavailable|taken|no longer available|conflict|already booked/i, ERROR_CODES.slotUnavailable],
  [/not found|unknown|no such/i, ERROR_CODES.notFound],
  [/invalid|must be|required|too many|too large/i, ERROR_CODES.invalidInput],
];

function textOf(result: CallToolResultLike): string {
  return (result.content ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function structuredError(value: unknown): { code?: string; message?: string } {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const inner = record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : record;
  return {
    code: typeof inner.code === 'string' ? inner.code : undefined,
    message: typeof inner.message === 'string' ? inner.message : undefined,
  };
}

export function codeFromText(text: string): string | null {
  return TEXT_CLUES.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** Turn a CallToolResult into data or an error the page can act on. */
export function readToolResult<T>(result: CallToolResultLike): ToolOutcome<T> {
  const text = textOf(result);
  if (result.isError) {
    const structured = structuredError(result.structuredContent);
    const message = structured.message ?? (text || 'The tool reported an error without a message.');
    return { ok: false, error: { code: structured.code ?? codeFromText(message), message } };
  }
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return { ok: true, data: result.structuredContent as T, text };
  }
  try {
    return { ok: true, data: JSON.parse(text) as T, text };
  } catch {
    return {
      ok: false,
      error: { code: ERROR_CODES.badResponse, message: 'The server answered, but not with data the page can read.' },
    };
  }
}
