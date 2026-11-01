'use strict';

/**
 * Minimal, allocation-safe Server-Sent Events helpers shared by the Rev
 * Intelligence gateway. No vendor dependency is needed and every frame is
 * validated before it reaches a merchant's browser.
 */

const MAX_BUFFER_CHARS = 2 * 1024 * 1024;

function safeJson(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createSseParser(onEvent) {
  if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function');
  let buffer = '';

  function parseFrame(raw) {
    if (!raw || !raw.trim()) return;
    let event = 'message';
    const dataLines = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        event = line.slice(6).trim() || 'message';
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    if (!dataLines.length) return;
    const payload = safeJson(dataLines.join('\n'));
    if (payload === null) return;
    onEvent(event, payload);
  }

  return {
    push(chunk) {
      if (typeof chunk !== 'string' || !chunk) return;
      buffer += chunk;
      if (buffer.length > MAX_BUFFER_CHARS) {
        // Drop an unbounded frame rather than exhausting gateway memory.
        buffer = '';
        return;
      }
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        parseFrame(raw);
        boundary = buffer.indexOf('\n\n');
      }
    },
    flush() {
      const remaining = buffer;
      buffer = '';
      parseFrame(remaining);
    },
  };
}

function formatSseFrame(event, data) {
  const name = String(event || 'message').replace(/[^a-zA-Z0-9_.-]/g, '');
  const payload = JSON.stringify(data === undefined ? null : data);
  return `event: ${name}\ndata: ${payload}\n\n`;
}

module.exports = { createSseParser, formatSseFrame, safeJson };
