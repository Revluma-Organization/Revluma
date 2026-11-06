'use strict';
/**
 * Pure drift analysis for Shopify webhook subscriptions.
 *
 * Used by the operator-run read-only drift report. It answers three
 * questions without mutating anything anywhere:
 *   1. Which required topics have NO matching subscription at (topic, uri)?
 *   2. Which subscriptions exist remotely that we do not require?
 *   3. Which required topics are fulfilled more than once (duplicate groups),
 *      and which live on a legacy delivery URL?
 */
const { REQUIRED_SUBSCRIPTIONS } = require('./shopifyWebhookTopics');

/**
 * @param {Array<{id:string, topic:string, uri:string}>} remote
 * @param {string} expectedBaseUrl  e.g. https://revluma-backend-vrsd.onrender.com (no trailing slash)
 */
function diffSubscriptions(remote, expectedBaseUrl) {
  const list = Array.isArray(remote) ? remote : [];
  const base = String(expectedBaseUrl || '').replace(/\/+$/, '');
  const expected = REQUIRED_SUBSCRIPTIONS.map(([topic, path]) => ({ topic, uri: `${base}/api/v1/webhooks/shopify/${path}` }));
  const report = {
    required: expected.length,
    remote_total: list.length,
    missing: [],
    unexpected: [],
    duplicates: [],
    legacy_url: [],
    fulfilled: 0,
  };
  const key = (topic, uri) => `${topic} ${uri}`;
  const remoteKeys = list.map((item) => key(item?.topic, item?.uri));
  const counts = new Map();
  for (const k of remoteKeys) counts.set(k, (counts.get(k) || 0) + 1);

  for (const item of list) {
    const uri = String(item?.uri || '');
    const isRequired = expected.some((entry) => entry.topic === item?.topic && entry.uri === uri);
    const sameTopicElsewhere = expected.some((entry) => entry.topic === item?.topic);
    if (!isRequired && sameTopicElsewhere) {
      report.legacy_url.push({ id: item.id, topic: item.topic, uri });
    } else if (!isRequired) {
      report.unexpected.push({ id: item.id, topic: item.topic, uri });
    }
  }

  for (const entry of expected) {
    const k = key(entry.topic, entry.uri);
    const count = counts.get(k) || 0;
    if (count === 0) report.missing.push(entry);
    else {
      report.fulfilled += 1;
      if (count > 1) report.duplicates.push({ topic: entry.topic, uri: entry.uri, count });
    }
  }
  for (const [k, count] of counts) {
    if (count > 1 && expected.some((entry) => key(entry.topic, entry.uri) === k)) continue;
    // duplicates of unexpected/legacy subscriptions are reported per-item above
  }
  report.drift = report.missing.length > 0 || report.unexpected.length > 0 || report.duplicates.length > 0 || report.legacy_url.length > 0;
  return report;
}

module.exports = { diffSubscriptions };
