'use strict';

const capabilities = require('../services/merchantCapabilityService');
const sidekick = require('../services/sidekickToolRegistry');
const { CommerceActionError } = require('../services/commerceActionPolicy');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateStore(req) {
  if (!UUID_RE.test(String(req.params.storeId || ''))) throw new CommerceActionError('INVALID_STORE_ID', 'store_id must be a UUID.', 400);
  return req.params.storeId;
}
function failure(error, res, next) {
  if (error instanceof CommerceActionError) return res.status(error.httpStatus || 409).json({ success: false, error: error.message, error_code: error.code });
  return next(error);
}

async function coverage(req, res, next) {
  res.set('Cache-Control', 'no-store');
  try {
    const report = await capabilities.getMerchantCoverage(validateStore(req), req.orgMembership.organizationId);
    return res.json({ success: true, ...report });
  } catch (error) { return failure(error, res, next); }
}
async function collections(req, res, next) {
  res.set('Cache-Control', 'no-store');
  try {
    const result = await capabilities.getCollections(validateStore(req), req.orgMembership.organizationId, req.query);
    return res.json({ success: true, ...result });
  } catch (error) { return failure(error, res, next); }
}
function sidekickFoundation(req, res) {
  res.set('Cache-Control', 'no-store');
  return res.json({ success: true, extension: sidekick.extensionManifest() });
}

module.exports = { coverage, collections, sidekickFoundation };
