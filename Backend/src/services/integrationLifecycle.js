'use strict';

const INTEGRATION_STATES = Object.freeze([
  'not_connected', 'connected', 'disconnected', 'reconnecting', 'reconnect_failed',
  'authorization_required', 'authorization_expired', 'authorization_revoked',
  'needs_attention', 'unknown',
]);

const REASONS = Object.freeze({
  CONNECTED: { severity: 'info', message: 'Shopify authorization is verified. Setup and synchronization status are shown separately.', merchantAction: false, retry: false, reconnect: false },
  MERCHANT_DISCONNECTED: { severity: 'info', message: 'You disconnected this Shopify store. Reconnect it when you want to restore access.', merchantAction: true, retry: false, reconnect: true },
  APP_UNINSTALLED: { severity: 'error', message: 'The Revluma app was uninstalled from Shopify. Reconnect your store to restore access.', merchantAction: true, retry: false, reconnect: true },
  AUTHORIZATION_REQUIRED: { severity: 'error', message: 'Your Shopify connection needs to be renewed. Reconnect your store to restore access.', merchantAction: true, retry: false, reconnect: true },
  AUTHORIZATION_EXPIRED: { severity: 'error', message: 'Your Shopify authorization has expired. Reconnect your store to renew it.', merchantAction: true, retry: false, reconnect: true },
  AUTHORIZATION_REVOKED: { severity: 'error', message: 'Shopify authorization was revoked. Reconnect your store to grant access again.', merchantAction: true, retry: false, reconnect: true },
  PERMISSIONS_MISSING: { severity: 'error', message: 'Some required permissions are missing. Reconnect and review the requested access before continuing.', merchantAction: true, retry: false, reconnect: true },
  PROVIDER_UNAVAILABLE: { severity: 'warning', message: 'Shopify is temporarily unavailable. Revluma can retry when the service is available; this does not mean your store disconnected.', merchantAction: false, retry: true, reconnect: false },
  PROVIDER_THROTTLED: { severity: 'warning', message: 'Shopify is rate limiting requests. Revluma will use bounded retries; your connection is not revoked.', merchantAction: false, retry: true, reconnect: false },
  WEBHOOK_REGISTRATION_FAILED: { severity: 'warning', message: 'Your store is authorized, but some webhooks could not be configured. Store updates may be delayed.', merchantAction: false, retry: true, reconnect: false },
  WEBHOOK_VERIFICATION_UNAVAILABLE: { severity: 'warning', message: 'We could not verify webhook registration. Some store updates may be delayed.', merchantAction: false, retry: true, reconnect: false },
  SYNC_FAILED: { severity: 'warning', message: 'Your initial synchronization failed. Your connection remains active, but some insights may be incomplete.', merchantAction: false, retry: true, reconnect: false },
  SYNC_PARTIAL: { severity: 'warning', message: 'Synchronization finished with limited coverage. Unavailable resources are listed below.', merchantAction: false, retry: true, reconnect: false },
  BACKEND_FAILURE: { severity: 'error', message: 'Revluma could not save or verify the integration state. No recovery is claimed; try again shortly.', merchantAction: false, retry: true, reconnect: false },
  OAUTH_CANCELLED: { severity: 'info', message: 'Shopify authorization was cancelled. Your previous connection state has not been replaced.', merchantAction: true, retry: false, reconnect: true },
  OAUTH_STATE_INVALID: { severity: 'error', message: 'The reconnect session is invalid or expired. Start reconnecting again from this page.', merchantAction: true, retry: false, reconnect: true },
  OAUTH_HMAC_INVALID: { severity: 'error', message: 'Shopify callback verification failed. Start reconnecting again; no credentials were changed.', merchantAction: true, retry: false, reconnect: true },
  TOKEN_EXCHANGE_FAILED: { severity: 'error', message: 'Shopify could not complete authorization. Try reconnecting again; no recovered connection is claimed.', merchantAction: true, retry: true, reconnect: true },
  WRONG_STORE: { severity: 'error', message: 'Shopify returned a different store than the one selected. Reconnect the intended store.', merchantAction: true, retry: false, reconnect: true },
  UNKNOWN: { severity: 'warning', message: 'We could not verify the integration state. Refresh diagnostics before taking action.', merchantAction: false, retry: true, reconnect: false },
});

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function safeReason(code) {
  return Object.hasOwn(REASONS, code) ? code : 'UNKNOWN';
}

function diagnosticFor(code, details = {}) {
  const reasonCode = safeReason(code);
  const definition = REASONS[reasonCode];
  return {
    reason_code: reasonCode,
    severity: definition.severity,
    explanation: definition.message,
    merchant_action_required: definition.merchantAction,
    recommended_action: definition.reconnect ? 'reconnect' : definition.retry ? 'retry_diagnostics' : 'none',
    retry_eligible: definition.retry,
    reconnect_eligible: definition.reconnect,
    resolution_state: details.resolved ? 'resolved' : 'open',
    last_occurrence: iso(details.lastOccurrence),
    capability: details.capability || 'shopify',
  };
}

function classifyShopifyError(error) {
  const code = String(error?.code || error?.networkCode || '').toUpperCase();
  const status = Number(error?.status || error?.providerStatus || error?.response?.status || 0);
  if (/EXPIRED/.test(code)) return 'AUTHORIZATION_EXPIRED';
  if (status === 401 || /TOKEN_INVALID|UNAUTHORIZED|ACCESS_TOKEN_MISSING|CREDENTIAL_UNUSABLE|ENCRYPTION_FORMAT_UNKNOWN/.test(code)) return 'AUTHORIZATION_REQUIRED';
  if (status === 403 || /ACCESS_DENIED|PERMISSION|SCOPE|NOT_GRANTED/.test(code)) return 'PERMISSIONS_MISSING';
  if (status === 429 || /THROTTLED|RATE_LIMIT/.test(code)) return 'PROVIDER_THROTTLED';
  if (status >= 500 || /ETIMEDOUT|ECONNRESET|ECONNABORTED|EAI_AGAIN|HTTP_ERROR|UNAVAILABLE/.test(code)) return 'PROVIDER_UNAVAILABLE';
  if (String(error?.code || '').startsWith('P')) return 'BACKEND_FAILURE';
  return 'UNKNOWN';
}

const EVENT_STATE = Object.freeze({
  merchant_disconnected: ['disconnected', 'MERCHANT_DISCONNECTED'],
  app_uninstalled: ['disconnected', 'APP_UNINSTALLED'],
  authorization_required: ['authorization_required', 'AUTHORIZATION_REQUIRED'],
  authorization_expired: ['authorization_expired', 'AUTHORIZATION_EXPIRED'],
  authorization_revoked: ['authorization_revoked', 'AUTHORIZATION_REVOKED'],
  permissions_missing: ['needs_attention', 'PERMISSIONS_MISSING'],
  reconnect_started: ['reconnecting', 'AUTHORIZATION_REQUIRED'],
  reconnect_failed: ['reconnect_failed', 'TOKEN_EXCHANGE_FAILED'],
  authorization_verified: ['connected', 'CONNECTED'],
  webhook_failed: ['needs_attention', 'WEBHOOK_REGISTRATION_FAILED'],
  sync_failed: ['needs_attention', 'SYNC_FAILED'],
  state_unknown: ['unknown', 'UNKNOWN'],
});

function evaluateTransition(store, event) {
  const definition = EVENT_STATE[event?.type];
  if (!definition) return { accepted: false, reason: 'unsupported_event' };
  const observedAt = iso(event.observedAt || new Date());
  if (!observedAt) return { accepted: false, reason: 'invalid_observed_at' };
  const verifiedAt = iso(store?.authorization_verified_at);
  // An uninstall generated before a newer OAuth verification must never tear
  // down the reconnected installation, even if its delivery arrives late.
  if (event.type === 'app_uninstalled' && verifiedAt && Date.parse(observedAt) < Date.parse(verifiedAt)) {
    return { accepted: false, reason: 'stale_uninstall' };
  }
  const changedAt = iso(store?.integration_changed_at);
  if (changedAt && Date.parse(observedAt) < Date.parse(changedAt) && event.type !== 'authorization_verified') {
    return { accepted: false, reason: 'stale_event' };
  }
  return {
    accepted: true,
    state: definition[0],
    reasonCode: safeReason(event.reasonCode || definition[1]),
    observedAt,
    clearAuthorization: ['merchant_disconnected', 'app_uninstalled', 'authorization_revoked'].includes(event.type),
  };
}

module.exports = {
  INTEGRATION_STATES, REASONS, diagnosticFor, classifyShopifyError,
  evaluateTransition, safeReason, iso,
};
