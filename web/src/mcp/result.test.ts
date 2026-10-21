import { describe, expect, it } from 'vitest';
import { CLIENT_ERROR_CODES, readToolResult } from './result';

const text = (value: string) => [{ type: 'text', text: value }];
const slot = {
  availability_id: 'avail_rest_001_20261023_1930',
  listing_id: 'rest_001',
  name: 'Siam Serenity',
  provider_type: 'restaurant',
  location: 'Bangkok',
  start_time: '2026-10-23T19:30:00+07:00',
  end_time: '2026-10-23T21:30:00+07:00',
  party_size: 2,
  service_type: null,
  room_type: null,
  price: 0,
  currency: 'THB',
  reason: 'A table for 2 is available at Siam Serenity',
};

describe('readToolResult', () => {
  it('prefers structured content', () => {
    expect(readToolResult({ content: text('{}'), structuredContent: { results: [] } })).toEqual({
      ok: true,
      data: { results: [] },
    });
  });

  it('falls back to JSON in the text', () => {
    const out = readToolResult<{ status: string }>({ content: text('{"status":"ok"}') });
    expect(out.ok && out.data.status).toBe('ok');
  });

  it('reads the contract business error, with its alternatives', () => {
    const out = readToolResult({
      isError: true,
      content: text('{}'),
      structuredContent: {
        error: {
          code: 'slot_unavailable',
          message: 'That time is no longer available.',
          retryable: true,
          booking_id: null,
          current_status: null,
        },
        alternatives: [slot],
      },
    });
    expect(out).toEqual({
      ok: false,
      error: {
        code: 'slot_unavailable',
        message: 'That time is no longer available.',
        retryable: true,
        alternatives: [slot],
        currentStatus: null,
      },
    });
  });

  it('keeps the booking status a business error reports', () => {
    const out = readToolResult({
      isError: true,
      structuredContent: {
        error: { code: 'invalid_state', message: 'An expired booking cannot be cancelled.', retryable: false, booking_id: 'b1', current_status: 'expired' },
        alternatives: [],
      },
    });
    expect(!out.ok && out.error).toMatchObject({ code: 'invalid_state', retryable: false, currentStatus: 'expired' });
  });

  it('reads input the server rejected before the tool ran, which comes back as plain text', () => {
    const out = readToolResult({
      isError: true,
      content: text('Error executing tool confirm_booking: 1 validation error for confirm_bookingArguments'),
    });
    expect(!out.ok && out.error.code).toBe(CLIENT_ERROR_CODES.invalidInput);
  });

  it('reports a success it cannot read', () => {
    const out = readToolResult({ content: text('all good') });
    expect(!out.ok && out.error.code).toBe(CLIENT_ERROR_CODES.badResponse);
  });
});
