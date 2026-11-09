import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSseParser, RevStreamError, streamRevAnswer } from './revStream';

vi.mock('@/lib/api', () => ({
  getApiBaseUrl: () => 'https://api.example.test/api/v1',
  getStreamingAuthHeaders: async () => ({ Authorization: 'Bearer scoped-token' }),
  createRequestId: () => '11111111-1111-4111-8111-111111111111',
  handleUnauthorized: vi.fn(),
}));
const REQUEST = '44444444-4444-4444-8444-444444444444';
const CONV = '33333333-3333-4333-8333-333333333333';
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const final = { success: true, conversation_id: CONV, read_only: true, response_type: 'analysis', text: 'Answer' };
function response(frames: string[], status = 200, contentType = 'text/event-stream') {
  const bytes = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) {
    frames.forEach(value => controller.enqueue(bytes.encode(value))); controller.close();
  } }), { status, headers: { 'Content-Type': contentType } });
}
function mockFetch(result: Response) { const mock = vi.fn().mockResolvedValue(result); vi.stubGlobal('fetch', mock); return mock; }
const options = { message: 'Revenue?', requestId: REQUEST, handlers: {} };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Task 223 transport integrity', () => {
  it('reuses the caller request ID verbatim', async () => {
    const fetch = mockFetch(response([frame('meta', { conversation_id: CONV }), frame('final', final)]));
    await streamRevAnswer(options);
    expect(JSON.parse(fetch.mock.calls[0][1].body).request_id).toBe(REQUEST);
  });
  it('uses credentialed same-origin browser semantics and bearer authentication', async () => {
    const fetch = mockFetch(response([frame('final', final)])); await streamRevAnswer(options);
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'include', method: 'POST' });
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer scoped-token');
  });
  it('never transmits an execute capability', async () => {
    const fetch = mockFetch(response([frame('final', final)])); await streamRevAnswer(options);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).not.toHaveProperty('execute');
  });
  it('scopes transport to an existing conversation', async () => {
    const fetch = mockFetch(response([frame('final', final)]));
    await streamRevAnswer({ ...options, conversationId: CONV });
    expect(JSON.parse(fetch.mock.calls[0][1].body).conversation_id).toBe(CONV);
  });
  it('preserves selected finding scope', async () => {
    const fetch = mockFetch(response([frame('final', final)]));
    await streamRevAnswer({ ...options, findingId: '11111111-1111-4111-8111-111111111111' });
    expect(JSON.parse(fetch.mock.calls[0][1].body).finding_id).toBe('11111111-1111-4111-8111-111111111111');
  });
  it('uses the server conversation ID rather than a client-invented ID', async () => {
    mockFetch(response([frame('final', final)]));
    expect(await streamRevAnswer(options)).toEqual({ conversationId: CONV, completed: true });
  });
  it('announces accepted metadata before processing events', async () => {
    const order: string[] = [];
    mockFetch(response([frame('meta', { conversation_id: CONV }), frame('plan', { steps: [] }), frame('final', final)]));
    await streamRevAnswer({ ...options, handlers: { onMeta: () => order.push('accepted'), onPlan: () => order.push('processing'), onFinal: () => order.push('completed') } });
    expect(order).toEqual(['accepted', 'processing', 'completed']);
  });
  it('exposes only real plan steps', async () => {
    const onPlan = vi.fn(); mockFetch(response([frame('plan', { steps: [{ id: 'real', tool: 'orders', label: 'Orders', status: 'running' }] }), frame('final', final)]));
    await streamRevAnswer({ ...options, handlers: { onPlan } });
    expect(onPlan.mock.calls[0][0].steps).toHaveLength(1);
  });
  it('passes evidence frames without promoting them to completion', async () => {
    const onEvidence = vi.fn(); const onFinal = vi.fn();
    mockFetch(response([frame('evidence', { items: [] }), frame('final', final)]));
    await streamRevAnswer({ ...options, handlers: { onEvidence, onFinal } });
    expect(onEvidence).toHaveBeenCalledWith({ items: [] }); expect(onFinal).toHaveBeenCalledOnce();
  });
  it('decodes split multibyte text without corruption', async () => {
    const data = new TextEncoder().encode(frame('final', { ...final, text: 'Revenue was ₦12,000.' }));
    const fetch = vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(data.slice(0, data.length - 7)); controller.enqueue(data.slice(data.length - 7)); controller.close();
    } }), { status: 200 }));
    vi.stubGlobal('fetch', fetch); const onFinal = vi.fn();
    await streamRevAnswer({ ...options, handlers: { onFinal } });
    expect(onFinal.mock.calls[0][0].text).toBe('Revenue was ₦12,000.');
  });
  it('supports CRLF SSE frames', async () => {
    mockFetch(response([frame('final', final).replaceAll('\n', '\r\n')]));
    await expect(streamRevAnswer(options)).resolves.toMatchObject({ completed: true });
  });
  it('joins multiline data fields before JSON parsing', async () => {
    const json = JSON.stringify(final);
    const split = json.indexOf(',') + 1;
    mockFetch(response([`event: final\ndata: ${json.slice(0, split)}\ndata: ${json.slice(split)}\n\n`]));
    await expect(streamRevAnswer(options)).resolves.toMatchObject({ completed: true });
  });

  for (const [status, code] of [[400, 'VALIDATION_ERROR'], [401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'CONVERSATION_NOT_FOUND'], [409, 'REV_TURN_IN_PROGRESS'], [429, 'RATE_LIMIT_EXCEEDED'], [500, 'STREAM_START_FAILED'], [502, 'INTELLIGENCE_UNAVAILABLE'], [503, 'INTELLIGENCE_UNAVAILABLE']] as const) {
    it(`returns typed HTTP ${status} failure with server code ${code}`, async () => {
      mockFetch(new Response(JSON.stringify({ error: { code, message: 'Actionable failure' } }), { status, headers: { 'Content-Type': 'application/json' } }));
      await expect(streamRevAnswer(options)).rejects.toMatchObject({ status, code });
    });
  }
  it('uses a safe failure for non-JSON error responses', async () => {
    mockFetch(new Response('bad gateway', { status: 502 }));
    await expect(streamRevAnswer(options)).rejects.toMatchObject({ status: 502, code: 'STREAM_START_FAILED' });
  });
  it('rejects a successful HTTP response with no body', async () => {
    mockFetch(new Response(null, { status: 200 }));
    await expect(streamRevAnswer(options)).rejects.toMatchObject({ code: 'STREAM_UNSUPPORTED' });
  });

  for (const [name, payload] of [
    ['success false', { ...final, success: false }],
    ['missing conversation', { ...final, conversation_id: null }],
    ['non-string text', { ...final, text: { answer: 'bad' } }],
    ['missing text', { success: true, conversation_id: CONV, response_type: 'analysis' }],
    ['missing response type', { ...final, response_type: null }],
    ['array envelope', []],
  ] as const) it(`fails closed for final with ${name}`, async () => {
    const onFinal = vi.fn(); mockFetch(response([frame('final', payload)]));
    await expect(streamRevAnswer({ ...options, handlers: { onFinal } })).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
    expect(onFinal).not.toHaveBeenCalled();
  });
  for (const [name, frames] of [
    ['empty stream', []],
    ['metadata only', [frame('meta', { conversation_id: CONV })]],
    ['plan without answer', [frame('plan', { steps: [] })]],
    ['evidence without answer', [frame('evidence', { items: [] })]],
    ['malformed JSON only', ['event: final\ndata: {broken}\n\n']],
  ]) it(`does not complete an ${name}`, async () => {
    mockFetch(response(frames));
    await expect(streamRevAnswer(options)).rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' });
  });
  it('prioritises an explicit safe server failure over incomplete completion', async () => {
    mockFetch(response([frame('error', { code: 'CURRENCY_UNVERIFIED', message: 'Currency unavailable.' })]));
    await expect(streamRevAnswer(options)).rejects.toMatchObject({ code: 'CURRENCY_UNVERIFIED' });
  });
  it('does not surface an error frame as a successful answer', async () => {
    const onFinal = vi.fn(); mockFetch(response([frame('error', { code: 'INTELLIGENCE_UNAVAILABLE' }), frame('final', final)]));
    await expect(streamRevAnswer({ ...options, handlers: { onFinal } })).rejects.toMatchObject({ code: 'INTELLIGENCE_UNAVAILABLE' });
    expect(onFinal).not.toHaveBeenCalled();
  });
  it('parses CRLF chunk boundaries in the standalone parser', () => {
    const seen: unknown[] = []; const parser = createSseParser((_event, data) => seen.push(data));
    parser.push('event: step\r\ndata: {"status":"running"}\r'); parser.push('\n\r\n');
    expect(seen).toEqual([{ status: 'running' }]);
  });
});
