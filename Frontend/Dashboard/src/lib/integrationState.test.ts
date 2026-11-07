import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_STATE_CONTRACT_VERSION,
  INTEGRATION_STATE_LABELS,
  INTEGRATION_STATE_STYLES,
  INTEGRATION_STATES,
  NOT_CONNECTED,
  isIntegrationStateName,
  normalizeIntegrationState,
  platformStatusFromStates,
  worstIntegrationState,
  type IntegrationState,
} from './integrationState';

const validState = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  contract_version: INTEGRATION_STATE_CONTRACT_VERSION,
  organization_id: 'org-1',
  integration_id: 'int-1',
  store: { id: 'store-1', shop_domain: 'shop.myshopify.com', provider: 'shopify', installed_at: null, last_synced_at: null },
  overall_status: 'connected',
  status_reason: 'all_verified',
  status_explanation: 'Everything verified.',
  merchant_action_required: false,
  recommended_next_step: null,
  authorization: { verification: 'verified', valid: true, verified: true, last_verified_at: '2026-11-07T00:00:00Z', missing_app_scopes: [] },
  synchronization: { state: 'completed', running_domains: [], failed_domains: [], partial_domains: [], last_succeeded_at: '2026-11-07T11:55:00Z' },
  evaluated_at: '2026-11-07T12:00:00Z',
  ...overrides,
});

describe('normalizeIntegrationState (fail-closed)', () => {
  it('accepts a valid contract block and exposes the typed fields', () => {
    const state = normalizeIntegrationState(validState());
    expect(state).not.toBeNull();
    expect(state?.overall_status).toBe('connected');
    expect(state?.store.id).toBe('store-1');
    expect(state?.synchronization.state).toBe('completed');
  });

  it('rejects an unknown contract version', () => {
    expect(normalizeIntegrationState(validState({ contract_version: 'rev-integration-state-v0' }))).toBeNull();
  });

  it('rejects an overall_status outside the closed set', () => {
    expect(normalizeIntegrationState(validState({ overall_status: 'healthy' }))).toBeNull();
    expect(normalizeIntegrationState(validState({ overall_status: undefined }))).toBeNull();
  });

  it('rejects a block with no usable store identity', () => {
    expect(normalizeIntegrationState(validState({ store: { id: '' } }))).toBeNull();
    expect(normalizeIntegrationState(validState({ store: null }))).toBeNull();
  });

  it('rejects malformed sub-blocks', () => {
    expect(normalizeIntegrationState(validState({ authorization: { verification: 'x' } }))).toBeNull();
    expect(normalizeIntegrationState(validState({ synchronization: null }))).toBeNull();
    expect(normalizeIntegrationState(validState({ authorization: { verification: 'x', verified: true, missing_app_scopes: 'nope' } }))).toBeNull();
  });

  it('rejects a block carrying credential material (defense in depth)', () => {
    const base = validState();
    expect(normalizeIntegrationState({ ...base, access_token: 'shpat_abcdef123456' })).toBeNull();
    expect(normalizeIntegrationState({ ...base, refresh_token: 'secret' })).toBeNull();
  });

  it('rejects non-objects outright', () => {
    expect(normalizeIntegrationState(null)).toBeNull();
    expect(normalizeIntegrationState(undefined)).toBeNull();
    expect(normalizeIntegrationState('connected')).toBeNull();
    expect(normalizeIntegrationState([])).toBeNull();
  });
});

describe('isIntegrationStateName', () => {
  it('recognizes exactly the closed set', () => {
    for (const state of INTEGRATION_STATES) expect(isIntegrationStateName(state)).toBe(true);
    expect(isIntegrationStateName('not_connected')).toBe(false);
    expect(isIntegrationStateName('healthy')).toBe(false);
    expect(isIntegrationStateName(42)).toBe(false);
  });
});

describe('worstIntegrationState', () => {
  const state = (overall_status: string): IntegrationState =>
    normalizeIntegrationState(validState({ overall_status })) as IntegrationState;

  it('returns null for an empty input', () => {
    expect(worstIntegrationState([])).toBeNull();
    expect(worstIntegrationState([null, undefined])).toBeNull();
  });

  it('orders by severity: revoked > expired > required > needs_attention > … > connected', () => {
    const states = [state('connected'), state('synchronizing'), state('needs_attention')];
    expect(worstIntegrationState(states)?.overall_status).toBe('needs_attention');
    expect(worstIntegrationState([state('connected'), state('limited_access')])?.overall_status).toBe('limited_access');
    expect(worstIntegrationState([state('limited_access'), state('disconnected')])?.overall_status).toBe('disconnected');
    expect(worstIntegrationState([state('authorization_revoked'), state('authorization_expired')])?.overall_status).toBe('authorization_revoked');
    // Order in the input must not matter.
    expect(worstIntegrationState([state('connected'), state('authorization_revoked')])?.overall_status).toBe('authorization_revoked');
    expect(worstIntegrationState([state('authorization_revoked'), state('connected')])?.overall_status).toBe('authorization_revoked');
  });

  it('a single non-connected store prevents claiming current data', () => {
    expect(worstIntegrationState([state('connected'), state('sync_failed')])?.overall_status).toBe('sync_failed');
  });
});

describe('platformStatusFromStates', () => {
  const state = (overall_status: string, provider = 'shopify'): IntegrationState =>
    normalizeIntegrationState(validState({ overall_status, store: { id: 's', shop_domain: 's.myshopify.com', provider, installed_at: null, last_synced_at: null } })) as IntegrationState;

  it('returns not_connected when the platform has no stores', () => {
    expect(platformStatusFromStates([], 'shopify')).toBe(NOT_CONNECTED);
    expect(platformStatusFromStates([state('connected', 'woocommerce')], 'shopify')).toBe(NOT_CONNECTED);
  });

  it('rolls up to the worst state among the platform stores', () => {
    expect(platformStatusFromStates([state('connected'), state('synchronizing')], 'shopify')).toBe('synchronizing');
    expect(platformStatusFromStates([state('connected')], 'shopify')).toBe('connected');
  });
});

describe('styles and labels', () => {
  it('has a label and a style for every status the UI can render', () => {
    for (const state of [...INTEGRATION_STATES, NOT_CONNECTED]) {
      expect(INTEGRATION_STATE_LABELS[state]).toBeTruthy();
      expect(INTEGRATION_STATE_STYLES[state]).toBeTruthy();
    }
  });

  it('reserves the green accent color for connected ONLY', () => {
    const green = 'hsl(var(--accent))';
    for (const state of [...INTEGRATION_STATES, NOT_CONNECTED]) {
      const { color } = INTEGRATION_STATE_STYLES[state];
      if (state === 'connected') expect(color).toBe(green);
      else expect(color).not.toBe(green);
    }
  });
});
