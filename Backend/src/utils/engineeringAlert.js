'use strict';

/**
 * Engineering alerts: infrastructure and pipeline problems that operators must
 * act on, and merchants must never be shown as banners.
 *
 * Every alert is one structured `engineering_alert` log line with a stable
 * `alert` code, a severity and bounded, PII-free context. Alerts are
 * de-duplicated per (alert, subject) inside a window so a persistent fault
 * produces a heartbeat of alerts rather than a log flood, and a recovery is
 * logged once as `engineering_alert_resolved`.
 */

const logger = require('./logger');

const DEFAULT_DEDUPE_MS = 30 * 60 * 1000;
const MAX_TRACKED = 2000;
const SEVERITIES = Object.freeze(['warning', 'error', 'critical']);

const lastRaised = new Map();

function keyFor(alert, subject) {
  return `${alert}:${subject || '-'}`;
}

function boundedContext(context) {
  const out = {};
  for (const [key, value] of Object.entries(context || {})) {
    if (value == null) continue;
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, 200);
    else if (value instanceof Date) out[key] = value.toISOString();
    else if (Array.isArray(value)) out[key] = value.slice(0, 20).map(item => String(item).slice(0, 80));
  }
  return out;
}

/**
 * Raise an alert. Returns true when it was emitted, false when suppressed as a
 * duplicate inside the dedupe window.
 */
function raiseAlert(alert, { severity = 'error', subject = null, dedupeMs = DEFAULT_DEDUPE_MS, now = Date.now(), ...context } = {}) {
  const level = SEVERITIES.includes(severity) ? severity : 'error';
  const key = keyFor(alert, subject);
  const previous = lastRaised.get(key);
  if (previous && now - previous < dedupeMs) return false;
  if (lastRaised.size >= MAX_TRACKED) {
    const oldest = lastRaised.keys().next().value;
    lastRaised.delete(oldest);
  }
  lastRaised.set(key, now);
  const payload = { alert, severity: level, subject, ...boundedContext(context) };
  if (level === 'warning') logger.warn('engineering_alert', payload);
  else logger.error('engineering_alert', payload);
  return true;
}

/** Mark an alert resolved. Logs only when it had been raised. */
function resolveAlert(alert, { subject = null, ...context } = {}) {
  const key = keyFor(alert, subject);
  if (!lastRaised.has(key)) return false;
  lastRaised.delete(key);
  logger.info('engineering_alert_resolved', { alert, subject, ...boundedContext(context) });
  return true;
}

function _resetForTests() {
  lastRaised.clear();
}

module.exports = { raiseAlert, resolveAlert, SEVERITIES, _resetForTests };
