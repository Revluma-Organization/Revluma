'use strict';

// Bounded per-process Rev metrics. Labels are allowlisted and may never contain
// request/conversation IDs, prompts, tenant data, credentials, or exception text.
const counters = new Map();
const latency = new Map();
const ALLOWED = new Set([
  'rev_requests_total', 'rev_general_questions_total', 'rev_investigations_total',
  'rev_provider_failures_total', 'rev_model_failures_total', 'rev_fallbacks_total',
  'rev_tool_failures_total', 'rev_validation_failures_total',
  'rev_conversation_restoration_failures_total', 'rev_persistence_failures_total',
]);
const LABEL = /^[a-z][a-z0-9_]{0,47}$/;
const VALUE = /^[A-Za-z0-9_.:-]{1,48}$/;
const ALLOWED_LABELS = new Set([
  'provider', 'model', 'category', 'outcome', 'stage', 'kind',
  'from_provider', 'to_provider', 'from_model', 'to_model',
]);
const MAX_SERIES = 512;

function safeLabels(labels = {}) {
  return Object.entries(labels).filter(([key, value]) =>
    LABEL.test(key) && ALLOWED_LABELS.has(key) && VALUE.test(String(value))
  ).slice(0, 4).sort(([a], [b]) => a.localeCompare(b));
}

function record(name, value = 1, labels = {}) {
  if (!ALLOWED.has(name)) return;
  const dimensions = safeLabels(labels);
  const key = `${name}|${JSON.stringify(dimensions)}`;
  if (!counters.has(key) && counters.size >= MAX_SERIES) return;
  counters.set(key, (counters.get(key) || 0) + Math.max(0, Math.min(Number(value) || 0, 1000000)));
}

function observe(name, milliseconds) {
  const value = Math.max(0, Math.min(Math.floor(Number(milliseconds) || 0), 3600000));
  if (!latency.has(name)) latency.set(name, []);
  const samples = latency.get(name);
  samples.push(value);
  if (samples.length > 2048) samples.shift();
}

function percentile(sorted, fraction) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] : 0;
}

function snapshot() {
  const counts = [...counters].map(([key, value]) => {
    const [name, encoded] = key.split('|');
    return { name, labels: Object.fromEntries(JSON.parse(encoded)), value };
  });
  const timings = {};
  for (const [name, values] of latency) {
    const sorted = [...values].sort((a, b) => a - b);
    timings[name] = {
      count: sorted.length,
      average_ms: sorted.length ? Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(2)) : 0,
      p50_ms: percentile(sorted, .5), p90_ms: percentile(sorted, .9),
      p95_ms: percentile(sorted, .95), p99_ms: percentile(sorted, .99),
      max_ms: sorted.at(-1) || 0,
    };
  }
  return { contract_version: 'rev-metrics-v1', counters: counts, latency_ms: timings };
}

function resetForTests() { counters.clear(); latency.clear(); }

module.exports = { record, observe, snapshot, resetForTests };
