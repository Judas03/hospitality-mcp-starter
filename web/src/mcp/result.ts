import type { Availability, BookingStatus } from '../contract/types';
import type { ToolError, ToolOutcome } from './types';

/** The parts of an MCP CallToolResult the page reads. */
export interface CallToolResultLike {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

/** Codes the page itself uses, next to the contract's business codes. */
export const CLIENT_ERROR_CODES = {
  invalidInput: 'invalid_input',
  badResponse: 'bad_response',
  unreachable: 'server_unreachable',
  sessionLost: 'session_lost',
  protocol: 'protocol_error',
} as const;

// Business errors carry a structured payload. Input the server rejects before the tool runs
// comes back as isError with plain text only, so that is read from the text.
const TEXT_CLUES: Array<[RegExp, string]> = [
  [/validation error|invalid|must be|required|should be/i, CLIENT_ERROR_CODES.invalidInput],
  [/unknown tool/i, CLIENT_ERROR_CODES.protocol],
];

function textOf(result: CallToolResultLike): string {
  return (result.content ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function toolError(message: string, code: string | null = null, extra: Partial<ToolError> = {}): ToolError {
  return { code, message, retryable: true, alternatives: [], currentStatus: null, ...extra };
}

function businessError(structured: unknown, text: string): ToolError {
  const payload = isRecord(structured) ? structured : {};
  const error = isRecord(payload.error) ? payload.error : {};
  const code = typeof error.code === 'string' ? error.code : null;
  const message = typeof error.message === 'string' ? error.message : text || 'The tool reported an error.';
  return {
    code: code ?? TEXT_CLUES.find(([pattern]) => pattern.test(message))?.[1] ?? null,
    message,
    retryable: typeof error.retryable === 'boolean' ? error.retryable : true,
    alternatives: Array.isArray(payload.alternatives) ? (payload.alternatives as Availability[]) : [],
    currentStatus: typeof error.current_status === 'string' ? (error.current_status as BookingStatus) : null,
  };
}

/** Turn a CallToolResult into data or an error the page can act on. */
export function readToolResult<T>(result: CallToolResultLike): ToolOutcome<T> {
  const text = textOf(result);
  if (result.isError) return { ok: false, error: businessError(result.structuredContent, text) };
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return { ok: true, data: result.structuredContent as T };
  }
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return {
      ok: false,
      error: toolError('The server answered, but not with data the page can read.', CLIENT_ERROR_CODES.badResponse, {
        retryable: false,
      }),
    };
  }
}
