'use strict';

const defaultDb = require('../configs/database').prisma;
const shopify = require('./shopifyProductAction');
const {
  ACTION_PRODUCT_DESCRIPTION, PREVIEW_TTL_MS, CommerceActionError,
  assertActionInput, actionRequestHash, assertConfirmation,
  assertCurrentDescription, publicAction, safeEqual,
} = require('./commerceActionPolicy');

const STALE_EXECUTION_MS = 5 * 60 * 1000;
// Merchant-facing writes are outside the read-only MVP, regardless of legacy flags.
function actionsEnabled() { return false; }
function safeErrorCode(error) { return String(error?.code || error?.name || 'commerce_action_failed').slice(0, 100); }

async function storeForOrganization(db, storeId, organizationId) {
  const store = await db.stores.findFirst({ where: { id: storeId, organization_id: organizationId, platform: 'shopify', access_token: { not: null } } });
  if (!store) throw new CommerceActionError('SHOPIFY_STORE_NOT_FOUND', 'Connected Shopify store not found for this organization.', 404);
  return store;
}

async function actionForOrganization(db, id, organizationId) {
  const row = await db.commerce_action_requests.findFirst({ where: { id, organization_id: organizationId } });
  if (!row) throw new CommerceActionError('ACTION_NOT_FOUND', 'Commerce action not found.', 404);
  return row;
}

async function audit(tx, row, action, context = {}) {
  await tx.audit_logs.create({ data: {
    organization_id: row.organization_id, user_id: row.requested_by_user_id,
    entity_type: 'commerce_action_request', entity_id: row.id, action,
    context: { action_type: row.action_type, resource_id: row.resource_id, ...context },
  } });
}

async function transition(db, row, fromStatus, toStatus, fields = {}, auditAction = `commerce_action_${toStatus}`) {
  return db.$transaction(async tx => {
    const claimed = await tx.commerce_action_requests.updateMany({
      where: { id: row.id, organization_id: row.organization_id, status: fromStatus },
      data: { status: toStatus, updated_at: new Date(), ...fields },
    });
    if (claimed.count !== 1) throw new CommerceActionError('ACTION_STATE_CONFLICT', 'The action changed in another request. Reload it before continuing.');
    await audit(tx, row, auditAction, { from_status: fromStatus, to_status: toStatus, error_code: fields.error_code || null });
    return tx.commerce_action_requests.findUnique({ where: { id: row.id } });
  });
}

async function createPreview(body, context, deps = {}) {
  const db = deps.db || defaultDb;
  const input = assertActionInput(body);
  const requestHash = actionRequestHash(input);
  const existing = await db.commerce_action_requests.findFirst({ where: { organization_id: context.organizationId, idempotency_key: input.idempotencyKey } });
  if (existing) {
    if (existing.request_hash !== requestHash) throw new CommerceActionError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key already belongs to a different action request.');
    return publicAction(existing);
  }
  const store = await storeForOrganization(db, input.storeId, context.organizationId);
  await shopify.requireLiveScope(store, 'read_products', deps.graphql);
  const product = await shopify.readProduct(store, input.productId, deps.graphql);
  if (product.description === input.description) throw new CommerceActionError('ACTION_ALREADY_APPLIED', 'The product already has this description; no update is necessary.');
  const now = new Date();
  const data = {
    organization_id: context.organizationId, store_id: store.id, requested_by_user_id: context.userId,
    action_type: ACTION_PRODUCT_DESCRIPTION, resource_id: input.productId,
    idempotency_key: input.idempotencyKey, request_hash: requestHash,
    input_json: { product_id: input.productId, description: input.description },
    preview_json: { title: product.title, before: { description: product.description }, after: { description: input.description }, read_at: now.toISOString() },
    rollback_json: { description: product.description }, status: 'awaiting_confirmation',
    confirmation_expires_at: new Date(now.getTime() + PREVIEW_TTL_MS), created_at: now, updated_at: now,
  };
  try {
    return await db.$transaction(async tx => {
      const row = await tx.commerce_action_requests.create({ data });
      await audit(tx, row, 'commerce_action_preview_created', { confirmation_expires_at: data.confirmation_expires_at });
      return publicAction(row);
    });
  } catch (error) {
    if (error?.code === 'P2002') {
      const raced = await db.commerce_action_requests.findFirst({ where: { organization_id: context.organizationId, idempotency_key: input.idempotencyKey } });
      if (raced?.request_hash === requestHash) return publicAction(raced);
      if (raced) throw new CommerceActionError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key already belongs to a different action request.');
    }
    throw error;
  }
}

function requireMutationGate(deps) {
  if (!actionsEnabled(deps.env)) throw new CommerceActionError('COMMERCE_ACTIONS_DISABLED', 'Shopify mutations are disabled by the production action gate.', 503);
}

async function confirmAction(id, body, context, deps = {}) {
  const db = deps.db || defaultDb;
  const row = await actionForOrganization(db, id, context.organizationId);
  if (['executed', 'execution_uncertain'].includes(row.status) && safeEqual(body?.confirmation_hash, row.request_hash)) return publicAction(row);
  assertConfirmation(row, body?.confirmation_hash);
  requireMutationGate(deps);
  if (row.action_type !== ACTION_PRODUCT_DESCRIPTION) throw new CommerceActionError('UNSUPPORTED_ACTION_TYPE', 'This action cannot be executed.', 400);
  const store = await storeForOrganization(db, row.store_id, context.organizationId);
  await shopify.requireLiveScope(store, 'write_products', deps.graphql);
  const before = await shopify.readProduct(store, row.resource_id, deps.graphql);
  assertCurrentDescription(before, row.rollback_json?.description);
  const executing = await transition(db, row, 'awaiting_confirmation', 'executing', { confirmed_at: new Date() }, 'commerce_action_confirmed');
  try {
    const product = await shopify.updateProductDescription(store, row.resource_id, row.input_json.description, deps.graphql);
    return publicAction(await transition(db, executing, 'executing', 'executed', {
      executed_at: new Date(), provider_result: { product_id: product.id, provider: 'shopify', verified_response: true }, error_code: null,
    }));
  } catch (error) {
    const rejected = error instanceof CommerceActionError && error.code === 'SHOPIFY_PRODUCT_UPDATE_REJECTED';
    return publicAction(await transition(db, executing, 'executing', rejected ? 'failed' : 'execution_uncertain', { error_code: safeErrorCode(error) }));
  }
}

async function rollbackAction(id, body, context, deps = {}) {
  const db = deps.db || defaultDb;
  const row = await actionForOrganization(db, id, context.organizationId);
  if (!safeEqual(body?.confirmation_hash, row.request_hash)) throw new CommerceActionError('CONFIRMATION_HASH_MISMATCH', 'The rollback confirmation does not match this action.', 400);
  if (['rolled_back', 'rollback_uncertain'].includes(row.status)) return publicAction(row);
  if (!['executed', 'rollback_failed'].includes(row.status)) throw new CommerceActionError('ACTION_NOT_ROLLBACKABLE', 'Only a successfully executed action with a verified current state can be rolled back.');
  requireMutationGate(deps);
  const store = await storeForOrganization(db, row.store_id, context.organizationId);
  await shopify.requireLiveScope(store, 'write_products', deps.graphql);
  const current = await shopify.readProduct(store, row.resource_id, deps.graphql);
  assertCurrentDescription(current, row.input_json?.description, 'PRODUCT_CHANGED_SINCE_EXECUTION');
  const rollingBack = await transition(db, row, row.status, 'rolling_back', {}, 'commerce_action_rollback_started');
  try {
    const product = await shopify.updateProductDescription(store, row.resource_id, row.rollback_json.description, deps.graphql);
    return publicAction(await transition(db, rollingBack, 'rolling_back', 'rolled_back', {
      rolled_back_at: new Date(), provider_result: { product_id: product.id, provider: 'shopify', verified_response: true, rolled_back: true }, error_code: null,
    }));
  } catch (error) {
    const rejected = error instanceof CommerceActionError && error.code === 'SHOPIFY_PRODUCT_UPDATE_REJECTED';
    return publicAction(await transition(db, rollingBack, 'rolling_back', rejected ? 'rollback_failed' : 'rollback_uncertain', { error_code: safeErrorCode(error) }));
  }
}

async function reconcileAction(id, context, deps = {}) {
  const db = deps.db || defaultDb;
  const row = await actionForOrganization(db, id, context.organizationId);
  const staleExecuting = ['executing', 'rolling_back'].includes(row.status) && new Date(row.updated_at).getTime() <= Date.now() - STALE_EXECUTION_MS;
  if (['executing', 'rolling_back'].includes(row.status) && !staleExecuting) {
    throw new CommerceActionError('ACTION_STILL_IN_PROGRESS', 'The action may still be running. Reconciliation is allowed after five minutes without a state update.');
  }
  if (!['execution_uncertain', 'rollback_uncertain'].includes(row.status) && !staleExecuting) return publicAction(row);
  const store = await storeForOrganization(db, row.store_id, context.organizationId);
  await shopify.requireLiveScope(store, 'read_products', deps.graphql);
  const product = await shopify.readProduct(store, row.resource_id, deps.graphql);
  const desired = String(row.input_json?.description || '');
  const original = String(row.rollback_json?.description || '');
  const current = String(product.description || '');
  let nextStatus = 'reconciliation_conflict';
  if (['execution_uncertain', 'executing'].includes(row.status)) {
    if (current === desired) nextStatus = 'executed';
    else if (current === original) nextStatus = 'failed';
  } else {
    if (current === original) nextStatus = 'rolled_back';
    else if (current === desired) nextStatus = 'executed';
  }
  if (nextStatus === 'reconciliation_conflict') throw new CommerceActionError('ACTION_RECONCILIATION_CONFLICT', 'The product has an unexpected description. Review it manually; no automatic rollback was attempted.');
  return publicAction(await transition(db, row, row.status, nextStatus, {
    ...(nextStatus === 'executed' ? { executed_at: new Date() } : {}),
    ...(nextStatus === 'rolled_back' ? { rolled_back_at: new Date() } : {}),
    provider_result: { product_id: product.id, provider: 'shopify', verified_by_reconciliation: true }, error_code: null,
  }, 'commerce_action_reconciled'));
}

async function getAction(id, context, deps = {}) { return publicAction(await actionForOrganization(deps.db || defaultDb, id, context.organizationId)); }
async function listActions(context, deps = {}) {
  const rows = await (deps.db || defaultDb).commerce_action_requests.findMany({ where: { organization_id: context.organizationId }, orderBy: { created_at: 'desc' }, take: 50 });
  return rows.map(publicAction);
}

module.exports = { actionsEnabled, createPreview, confirmAction, rollbackAction, reconcileAction, getAction, listActions };
