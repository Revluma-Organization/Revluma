'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSseParser, formatSseFrame, safeJson } = require('../revStream');

test('SSE parser handles chunk boundaries, CRLF and multi-line data', () => {
  const events = [];
  const parser = createSseParser((event, data) => events.push({ event, data }));
  parser.push('event: plan\r\ndata: {"steps":');
  parser.push('[{"id":"step-1"}]}\r\n\r\n');
  parser.push(': keep-alive comment\n\n');
  parser.push('event: step\ndata: {"status":"completed"}\n\n');
  parser.push('data: {"a":');
  parser.push('1}');
  parser.flush();
  assert.deepEqual(events[0], { event: 'plan', data: { steps: [{ id: 'step-1' }] } });
  assert.deepEqual(events[1], { event: 'step', data: { status: 'completed' } });
  assert.deepEqual(events[2], { event: 'message', data: { a: 1 } });
});

test('SSE parser ignores malformed JSON rather than throwing', () => {
  const events = [];
  const parser = createSseParser((event, data) => events.push({ event, data }));
  assert.doesNotThrow(() => {
    parser.push('event: step\ndata: not-json\n\n');
    parser.push('event: final\ndata: {"ok":true}\n\n');
  });
  assert.deepEqual(events, [{ event: 'final', data: { ok: true } }]);
});

test('SSE frames are single-line and strip unsafe event names', () => {
  const frame = formatSseFrame('final\nX-Injected', { text: 'hi' });
  assert.equal(frame, 'event: finalX-Injected\ndata: {"text":"hi"}\n\n');
  assert.equal(frame.split('\n').filter(Boolean).length, 2);
  assert.equal(safeJson('{"broken"'), null);
});
