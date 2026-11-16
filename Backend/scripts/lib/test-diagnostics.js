'use strict';

const path = require('path');

// Actions truncates annotation messages to 4096 characters. Stay below that
// limit so the trailing assertion and stack are retrievable through the API.
const MAX_DIAGNOSTIC_CHARS = 3000;

function redactDiagnostics(output, env = process.env) {
  let text = String(output || '').replace(/\u001b\[[0-9;]*m/g, '');
  // This runs in test CI, but still never republish credentials from test logs
  // into durable check annotations. Retain assertions and stack frames.
  const secrets = Object.entries(env)
    .filter(([key, value]) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|DATABASE_URL|DIRECT_URL)/i.test(key)
      && typeof value === 'string' && value.length >= 4)
    .map(([, value]) => value)
    .sort((left, right) => right.length - left.length);
  for (const value of secrets) text = text.split(value).join('[REDACTED]');
  return text
    .replace(/\b(?:postgres(?:ql)?|redis|rediss):\/\/[^\s'"<>]+/gi, '[REDACTED_CONNECTION_URL]')
    .replace(/\bBearer\s+[^\s'"<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\b((?:access_token|refresh_token|api_key|password|client_secret)["']?\s*[:=]\s*["']?)[^\s'",}\]]+/gi, '$1[REDACTED]');
}

function escapeCommand(value) {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

function failureAnnotation(file, output, env = process.env) {
  const name = path.basename(file).replace(/[^A-Za-z0-9._-]/g, '_');
  const safe = redactDiagnostics(output, env);
  const truncated = safe.length > MAX_DIAGNOSTIC_CHARS;
  const detail = (truncated ? '[Earlier output omitted; full output is in the job log.]\n' : '')
    + safe.slice(-MAX_DIAGNOSTIC_CHARS);
  return `::error title=Backend test failed - ${name}::${escapeCommand(detail || 'Test process exited unsuccessfully without output.')}\n`;
}

module.exports = { failureAnnotation, redactDiagnostics, MAX_DIAGNOSTIC_CHARS };
