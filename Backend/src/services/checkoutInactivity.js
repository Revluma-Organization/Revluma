'use strict';

const ABANDONMENT_INACTIVITY_MS = 15 * 60 * 1000;

function lastCheckoutActivity(payload, now = new Date()) {
  const timestamp = payload.updated_at || payload.updatedAt || payload.created_at || payload.createdAt;
  const date = timestamp ? new Date(timestamp) : now;
  return Number.isFinite(date.getTime()) ? date : now;
}

function isCheckoutInactive(updatedAt, now = new Date()) {
  const activity = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  return Number.isFinite(activity.getTime()) &&
    now.getTime() - activity.getTime() >= ABANDONMENT_INACTIVITY_MS;
}

function nextCheckoutStatus({ completedAt, existingStatus, isStale, sourceAbandoned }) {
  if (completedAt || existingStatus === 'recovered') return 'recovered';
  if (isStale) return existingStatus || 'pending';
  // Only Shopify's abandonedCheckouts resource proves abandonment. Age alone
  // remains inactivity, never a lifecycle classification.
  if (sourceAbandoned) return 'abandoned';
  return 'pending';
}

module.exports = { ABANDONMENT_INACTIVITY_MS, lastCheckoutActivity, isCheckoutInactive, nextCheckoutStatus };
