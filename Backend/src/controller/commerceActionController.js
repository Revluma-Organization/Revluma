'use strict';

const actions = require('../services/commerceActionService');
const { CommerceActionError } = require('../services/commerceActionPolicy');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function context(req) {
  return { organizationId: req.orgMembership.organizationId, userId: req.user.id };
}
function noStore(res) { res.set('Cache-Control', 'no-store'); }
function assertId(id) {
  if (!UUID_RE.test(String(id || ''))) throw new CommerceActionError('INVALID_ACTION_ID', 'Action id must be a UUID.', 400);
}
function handleError(error, req, res, next) {
  if (error instanceof CommerceActionError) {
    return res.status(error.httpStatus || 409).json({ success: false, error: error.message, error_code: error.code });
  }
  return next(error);
}

async function createPreview(req, res, next) {
  noStore(res);
  try { return res.status(201).json({ success: true, action: await actions.createPreview(req.body, context(req)) }); }
  catch (error) { return handleError(error, req, res, next); }
}
async function confirm(req, res, next) {
  noStore(res);
  try { assertId(req.params.id); return res.json({ success: true, action: await actions.confirmAction(req.params.id, req.body, context(req)) }); }
  catch (error) { return handleError(error, req, res, next); }
}
async function rollback(req, res, next) {
  noStore(res);
  try { assertId(req.params.id); return res.json({ success: true, action: await actions.rollbackAction(req.params.id, req.body, context(req)) }); }
  catch (error) { return handleError(error, req, res, next); }
}
async function reconcile(req, res, next) {
  noStore(res);
  try { assertId(req.params.id); return res.json({ success: true, action: await actions.reconcileAction(req.params.id, context(req)) }); }
  catch (error) { return handleError(error, req, res, next); }
}
async function get(req, res, next) {
  noStore(res);
  try { assertId(req.params.id); return res.json({ success: true, action: await actions.getAction(req.params.id, context(req)) }); }
  catch (error) { return handleError(error, req, res, next); }
}
async function list(req, res, next) {
  noStore(res);
  try { return res.json({ success: true, actions: await actions.listActions(context(req)) }); }
  catch (error) { return handleError(error, req, res, next); }
}

module.exports = { createPreview, confirm, rollback, reconcile, get, list };
