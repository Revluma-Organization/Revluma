function normalizeAffiliateStatusForClient(status) {
  if (!status) return 'pending_review';
  return String(status).toLowerCase();
}

module.exports = {
  normalizeAffiliateStatusForClient
};