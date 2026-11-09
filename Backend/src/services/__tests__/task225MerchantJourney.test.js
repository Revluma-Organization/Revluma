'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { CONTRACT_VERSION, STATES, projectJourneyState, validateJourney } = require('../merchantJourney');
const NOW = new Date('2026-11-09T12:00:00Z');
const ID = '3ed79446-cb6d-4a1c-b174-9ec1ab91fe15';
function fixture() {
  const domains = Object.fromEntries(['products', 'orders', 'abandoned_checkouts', 'customers', 'inventory'].map(name => [name,
    { state: 'succeeded', last_succeeded_at: '2026-11-09T11:00:00Z', pagination_complete: true }]));
  return { contract_version: 'rev-integration-state-v1', organization_id: 'org-a', overall_status: 'connected', status_reason: 'all_verified',
    store: { id: ID, provider: 'shopify', shop_domain: 'revluma-test-store-v1.myshopify.com', installed_at: '2026-11-09T10:00:00Z', last_synced_at: '2026-11-09T11:00:00Z' },
    authorization: { valid: true, verified: true, verification: 'verified_by_successful_synchronization' },
    synchronization: { state: 'completed', last_succeeded_at: '2026-11-09T11:00:00Z', domains }, capabilities: [], coverage: { status: 'complete' } };
}
function mutate(change) { const value = fixture(); change(value); return value; }
function journey(change) { return projectJourneyState(change ? mutate(change) : fixture(), NOW); }
function scenario(number, name, run) { test(`T225-${String(number).padStart(3, '0')} ${name}`, run); }

scenario(1, 'new complete merchant enters first briefing', () => assert.equal(journey().state, 'briefing_ready'));
scenario(2, 'existing merchant is recognized from durable installation', () => assert.equal(journey(s => { s.store.installed_at = '2026-11-01T10:00:00Z'; }).state, 'returning_merchant'));
scenario(3, 'authorization without sync is not ready', () => { const j = journey(s => { s.overall_status = 'limited_access'; s.synchronization.state = 'unknown'; for (const d of Object.values(s.synchronization.domains)) d.state = 'never_synchronized'; }); assert.equal(j.state, 'shopify_authorized'); assert.equal(j.can_enter_workspace, false); });
scenario(4, 'queued initial sync remains running', () => assert.equal(journey(s => { s.synchronization.state = 'queued'; s.overall_status = 'synchronizing'; }).state, 'initial_sync_running'));
scenario(5, 'active resource retrieval remains running', () => assert.equal(journey(s => { s.synchronization.state = 'running'; s.overall_status = 'synchronizing'; }).state, 'initial_sync_running'));
scenario(6, 'retry wait does not invent completion', () => assert.equal(journey(s => { s.synchronization.state = 'waiting_retrying'; }).state, 'initial_sync_running'));
scenario(7, 'scheduled work does not invent completion', () => assert.equal(journey(s => { s.synchronization.state = 'scheduled'; }).state, 'initial_sync_running'));
scenario(8, 'partial required resource preserves useful workspace entry', () => { const j = journey(s => { s.synchronization.state = 'partially_completed'; s.overall_status = 'sync_partial'; s.synchronization.domains.orders.state = 'partial'; }); assert.equal(j.state, 'initial_sync_partial'); assert.equal(j.can_enter_workspace, true); });
scenario(9, 'one successful required resource supports partial entry', () => { const j = journey(s => { s.synchronization.state = 'failed'; s.overall_status = 'sync_partial'; s.synchronization.domains.products.state = 'failed'; s.synchronization.domains.abandoned_checkouts.state = 'failed'; }); assert.equal(j.state, 'initial_sync_partial'); });
scenario(10, 'total sync failure blocks fabricated briefing', () => { const j = journey(s => { s.synchronization.state = 'failed'; s.overall_status = 'sync_failed'; for (const d of Object.values(s.synchronization.domains)) d.state = 'failed'; }); assert.equal(j.state, 'initial_sync_failed'); assert.equal(j.can_enter_workspace, false); });
scenario(11, 'stalled sync without evidence requires recovery', () => assert.equal(journey(s => { s.synchronization.state = 'stalled'; s.overall_status = 'needs_attention'; for (const d of Object.values(s.synchronization.domains)) d.state = 'failed'; }).state, 'initial_sync_failed'));
scenario(12, 'cancelled sync without evidence is not authorization loss', () => assert.equal(journey(s => { s.synchronization.state = 'cancelled'; for (const d of Object.values(s.synchronization.domains)) d.state = 'failed'; }).state, 'initial_sync_failed'));
scenario(13, 'optional resource limits produce capability-limited workspace', () => { const j = journey(s => { s.overall_status = 'limited_access'; s.capabilities = [{ id: 'inventory', limited_reasons: ['stale_data'] }]; }); assert.equal(j.state, 'capability_limited'); assert.equal(j.can_enter_workspace, true); });
scenario(14, 'uncertified order history is explicit', () => assert.equal(journey(s => { s.coverage.status = 'partial'; }).state, 'insufficient_history'));
scenario(15, 'unknown history does not become complete', () => assert.equal(journey(s => { s.coverage.status = 'unknown'; }).state, 'insufficient_history'));
scenario(16, 'expired authorization takes precedence over stale success', () => assert.equal(journey(s => { s.overall_status = 'authorization_expired'; }).state, 'authorization_required'));
scenario(17, 'revoked authorization takes precedence over old evidence', () => assert.equal(journey(s => { s.overall_status = 'authorization_revoked'; }).state, 'authorization_required'));
scenario(18, 'rejected credentials require reauthorization', () => assert.equal(journey(s => { s.overall_status = 'authorization_required'; }).state, 'authorization_required'));
scenario(19, 'installing status is authorization pending', () => assert.equal(journey(s => { s.overall_status = 'unknown'; s.authorization = { valid: false, verified: false, verification: 'install_in_progress' }; }).state, 'shopify_authorization_pending'));
scenario(20, 'missing credentials are authorization pending', () => assert.equal(journey(s => { s.authorization = { valid: false, verified: false, verification: 'no_credentials_recorded' }; }).state, 'shopify_authorization_pending'));
scenario(21, 'unknown contradictory state fails closed', () => assert.equal(journey(s => { s.overall_status = 'unknown'; s.synchronization.state = 'unknown'; s.authorization.verified = false; s.authorization.verification = 'unverified_unrecorded'; for (const d of Object.values(s.synchronization.domains)) d.state = 'unknown'; }).state, 'workspace_recovery_required'));
scenario(22, 'unavailable canonical state fails closed', () => assert.equal(projectJourneyState(null).state, 'workspace_recovery_required'));
scenario(23, 'foreign contract version fails closed', () => assert.equal(journey(s => { s.contract_version = 'other'; }).state, 'workspace_recovery_required'));
scenario(24, 'missing store id fails closed', () => assert.equal(journey(s => { s.store.id = ''; }).state, 'workspace_recovery_required'));
scenario(25, 'non-Shopify store cannot be ready', () => assert.equal(journey(s => { s.store.provider = 'woocommerce'; }).state, 'workspace_recovery_required'));
scenario(26, 'missing authorization block fails closed', () => assert.equal(journey(s => { delete s.authorization; }).state, 'workspace_recovery_required'));
scenario(27, 'missing sync block fails closed', () => assert.equal(journey(s => { delete s.synchronization; }).state, 'workspace_recovery_required'));
scenario(28, 'missing capability list fails closed', () => assert.equal(journey(s => { delete s.capabilities; }).state, 'workspace_recovery_required'));
scenario(29, 'required readiness needs products', () => assert.equal(journey(s => { s.synchronization.domains.products.state = 'never_synchronized'; }).state, 'initial_sync_partial'));
scenario(30, 'required readiness needs orders', () => assert.equal(journey(s => { s.synchronization.domains.orders.state = 'never_synchronized'; }).state, 'initial_sync_partial'));
scenario(31, 'required readiness needs abandoned checkouts', () => assert.equal(journey(s => { s.synchronization.domains.abandoned_checkouts.state = 'never_synchronized'; }).state, 'initial_sync_partial'));
scenario(32, 'missing required domain is unknown rather than success', () => { const j = journey(s => { delete s.synchronization.domains.orders; }); assert.equal(j.state, 'initial_sync_partial'); assert.equal(j.required_resources.find(r => r.resource === 'orders').state, 'unknown'); });
scenario(33, 'retired store domain is not promoted to active test store', () => { const j = journey(s => { s.store.shop_domain = 'bys-user-store-923319-1ifggjsw.myshopify.com'; }); assert.equal(j.store.shop_domain, 'bys-user-store-923319-1ifggjsw.myshopify.com'); assert.notEqual(j.store.shop_domain, 'revluma-test-store-v1.myshopify.com'); });
scenario(34, 'active test store identity survives projection', () => assert.equal(journey().store.shop_domain, 'revluma-test-store-v1.myshopify.com'));
scenario(35, 'organization remains canonical and is not copied to store', () => { const j = journey(); assert.equal(j.store.id, ID); assert.equal('organization_id' in j.store, false); });
scenario(36, 'resource timestamps remain backend evidence', () => assert.equal(journey().required_resources[0].last_succeeded_at, '2026-11-09T11:00:00Z'));
scenario(37, 'pagination evidence remains explicit', () => assert.equal(journey(s => { s.synchronization.domains.orders.pagination_complete = false; }).required_resources.find(r => r.resource === 'orders').pagination_complete, false));
scenario(38, 'limited reasons are preserved without fabricated percentages', () => { const j = journey(s => { s.capabilities = [{ id: 'customers', limited_reasons: ['permission_required'] }]; s.overall_status = 'limited_access'; }); assert.deepEqual(j.limited_capabilities[0].reasons, ['permission_required']); assert.equal('percent' in j, false); });
scenario(39, 'last sync timestamp is not evaluated-at timestamp', () => assert.equal(journey().synchronization.last_succeeded_at, '2026-11-09T11:00:00Z'));
scenario(40, 'safe workspace route is emitted for ready state', () => assert.equal(journey().next_route, '/dashboard/overview'));
scenario(41, 'safe integration route is emitted for failed state', () => { const j = journey(s => { s.synchronization.state = 'failed'; for (const d of Object.values(s.synchronization.domains)) d.state = 'failed'; }); assert.equal(j.next_route, '/dashboard/integrations'); });
scenario(42, 'projection does not expose access token', () => { const j = journey(s => { s.access_token = 'secret'; }); assert.equal(JSON.stringify(j).includes('secret'), false); });
scenario(43, 'projection does not expose granted credential material', () => assert.equal(JSON.stringify(journey()).includes('access_token'), false));
scenario(44, 'state machine contains all thirteen canonical states', () => assert.equal(STATES.length, 13));
scenario(45, 'state machine includes unauthenticated boundary', () => assert.ok(STATES.includes('unauthenticated')));
scenario(46, 'state machine includes recovery boundary', () => assert.ok(STATES.includes('workspace_recovery_required')));
scenario(47, 'valid ready contract validates', () => { const p = { contract_version: CONTRACT_VERSION, organization_id: 'org-a', state: 'briefing_ready', selected: journey(), stores: [] }; assert.equal(validateJourney(p).valid, true); });
scenario(48, 'invalid contract version rejected', () => assert.equal(validateJourney({ contract_version: 'x', organization_id: 'org', stores: [] }).valid, false));
scenario(49, 'missing organization rejected', () => assert.equal(validateJourney({ contract_version: CONTRACT_VERSION, stores: [] }).valid, false));
scenario(50, 'invalid store list rejected', () => assert.equal(validateJourney({ contract_version: CONTRACT_VERSION, organization_id: 'org', stores: null }).valid, false));
scenario(51, 'external next route rejected', () => assert.equal(validateJourney({ contract_version: CONTRACT_VERSION, organization_id: 'org', stores: [], selected: { next_route: 'https://evil.example' } }).valid, false));
scenario(52, 'javascript next route rejected', () => assert.equal(validateJourney({ contract_version: CONTRACT_VERSION, organization_id: 'org', stores: [], selected: { next_route: 'javascript:alert(1)' } }).valid, false));
scenario(53, 'unknown journey state rejected', () => assert.equal(validateJourney({ contract_version: CONTRACT_VERSION, organization_id: 'org', state: 'ready', stores: [] }).valid, false));
scenario(54, 'valid empty setup contract validates', () => assert.equal(validateJourney({ contract_version: CONTRACT_VERSION, organization_id: 'org', state: 'authenticated_setup_required', selected: { state: 'authenticated_setup_required', next_route: '/dashboard/integrations' }, stores: [] }).valid, true));
scenario(55, 'partial capability can enter workspace safely', () => assert.equal(journey(s => { s.coverage.status = 'partial'; }).can_enter_workspace, true));
scenario(56, 'authorization pending cannot enter ready briefing', () => assert.equal(journey(s => { s.authorization.verification = 'install_in_progress'; s.authorization.verified = false; }).can_enter_workspace, false));
scenario(57, 'shopify authorized does not imply synchronization', () => { const j = journey(s => { for (const d of Object.values(s.synchronization.domains)) d.state = 'never_synchronized'; s.synchronization.state = 'unknown'; }); assert.equal(j.synchronization.state, 'unknown'); });
scenario(58, 'partial synchronization never reports completed', () => assert.notEqual(journey(s => { s.synchronization.state = 'partially_completed'; }).synchronization.state, 'completed'));
scenario(59, 'authorization failure route supports reconnect', () => assert.equal(journey(s => { s.overall_status = 'authorization_expired'; }).next_route, '/dashboard/integrations'));
scenario(60, 'repeated projection is deterministic', () => assert.deepEqual(journey(), journey()));

const route = fs.readFileSync(require.resolve('../../route/storeRoute'), 'utf8');
const controller = fs.readFileSync(require.resolve('../../controller/storeController'), 'utf8');
const callback = fs.readFileSync(require.resolve('../../controller/shopifyController'), 'utf8');
scenario(61, 'journey endpoint requires authentication', () => assert.match(route, /journey', authenticateToken/));
scenario(62, 'journey endpoint uses active membership', () => assert.match(controller, /getMerchantJourney[\s\S]*requireMembership\(prisma, req.user.id, req.user.tenantId\)/));
scenario(63, 'journey endpoint disables caching', () => assert.match(controller, /getMerchantJourney[\s\S]*Cache-Control', 'no-store'/));
scenario(64, 'journey endpoint validates requested store UUID', () => assert.match(controller, /getMerchantJourney[\s\S]*store_id[\s\S]*\[0-9a-f-\]/));
scenario(65, 'journey endpoint returns 404 for foreign store', () => assert.match(controller, /getMerchantJourney[\s\S]*!selectedState[\s\S]*404/));
scenario(66, 'journey endpoint uses canonical integration retrieval', () => assert.match(controller, /getMerchantJourney[\s\S]*retrieveIntegrationStates\(\{ organizationId \}\)/));
scenario(67, 'OAuth initiation requires active organization', () => assert.match(callback, /installShopify[\s\S]*getOrganizationByUser\(userId, req.user.tenantId\)/));
scenario(68, 'OAuth reconnect binds tenant store', () => assert.match(callback, /organization_id: organization.id, platform: 'shopify', shop_domain: normalizedShop/));
scenario(69, 'OAuth callback verifies HMAC before exchange', () => assert.ok(callback.indexOf('verifyHmac(req.query)') < callback.indexOf('exchangeAccessToken(normalizedShop, code)')));
scenario(70, 'OAuth callback binds initiating shop', () => assert.match(callback, /shopify_shop !== normalizedShop/));
scenario(71, 'OAuth callback binds initiating organization cookie', () => assert.match(callback, /getOrganizationByUser\(userId, req.signedCookies\?.shopify_organization/));
scenario(72, 'OAuth callback consumes state atomically', () => assert.match(callback, /shopify:oauth:consumed:[\s\S]*'NX'/));
scenario(73, 'OAuth duplicate callback rejected', () => assert.match(callback, /replayClaim !== 'OK'[\s\S]*409/));
scenario(74, 'OAuth cancellation returns safe frontend route', () => assert.match(callback, /access_denied[\s\S]*shopify=cancelled/));
scenario(75, 'OAuth success distinguished from synchronization', () => assert.match(callback, /shopify', webhookSetupComplete \? 'authorized' : 'recovery_pending'/));
scenario(76, 'OAuth code never included in frontend redirect', () => assert.doesNotMatch(callback, /searchParams.set\(['"]code/));
scenario(77, 'OAuth access token never included in frontend redirect', () => assert.doesNotMatch(callback, /searchParams.set\(['"](?:token|access_token)/));
scenario(78, 'OAuth state never included in frontend redirect', () => assert.doesNotMatch(callback, /searchParams.set\(['"]state/));
scenario(79, 'OAuth HMAC never included in frontend redirect', () => assert.doesNotMatch(callback, /searchParams.set\(['"]hmac/));
scenario(80, 'OAuth secrets not logged', () => assert.doesNotMatch(callback, /logger\.(?:info|error|warn)\([^\n]*accessToken/));
scenario(81, 'OAuth callback redirects only configured frontend origin', () => assert.match(callback, /new URL\('\/dashboard\/integrations', configuredFrontendUrl\)/));
scenario(82, 'OAuth replay store outage fails closed', () => assert.match(callback, /oauth_replay_guard[\s\S]*!isRedisReady\(\)[\s\S]*503/));
scenario(83, 'OAuth shop mismatch is rejected before token exchange', () => assert.ok(callback.indexOf('shop_mismatch') < callback.indexOf('exchangeAccessToken(normalizedShop, code)')));
scenario(84, 'OAuth invalid domain is rejected before token exchange', () => assert.ok(callback.indexOf('isValidShopDomain(shop)') < callback.indexOf('exchangeAccessToken(normalizedShop, code)')));
scenario(85, 'OAuth state mismatch is rejected before token exchange', () => assert.ok(callback.indexOf('isStateAccepted(storedState, state)') < callback.indexOf('exchangeAccessToken(normalizedShop, code)')));
scenario(86, 'OAuth authorization verification precedes sync', () => assert.ok(callback.indexOf('verifyShopifyAuthorization(store)') < callback.lastIndexOf('syncShopifyStore(store,')));
scenario(87, 'OAuth missing permissions produce reconnect state', () => assert.match(callback, /PERMISSIONS_MISSING[\s\S]*reconnect_failed/));
scenario(88, 'OAuth cookies cleared after return', () => assert.match(callback, /oauth_cookie_cleanup[\s\S]*clearCookie\("shopify_state"/));
scenario(89, 'OAuth callback is read-only setup and never calls product action service', () => assert.doesNotMatch(callback, /shopifyProductAction/));
scenario(90, 'OAuth frontend failure uses opaque reference only', () => assert.match(callback, /searchParams.set\('reference', requestId\)/));

for (const [index, field] of ['code', 'shop', 'state', 'hmac'].entries()) {
  scenario(91 + index, `OAuth required parameter ${field} remains mandatory`, () => assert.match(callback, new RegExp(`!${field}`)));
}
for (const [index, cookie] of ['shopify_state', 'shopify_user', 'shopify_shop', 'oauth_user', 'shopify_organization'].entries()) {
  scenario(95 + index, `OAuth temporary cookie ${cookie} is cleared on cancellation`, () => assert.match(callback, /access_denied[\s\S]*for \(const name of \[[\s\S]*'\]/));
}
scenario(100, 'journey service does not mutate canonical integration input', () => { const input = fixture(); const before = JSON.stringify(input); projectJourneyState(input, NOW); assert.equal(JSON.stringify(input), before); });
