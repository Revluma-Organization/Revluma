const {
  rebuildBusinessState,
  evaluateRecommendationOutcomes,
} = require('../services/mlService');

function gatewayStatus(result) {
  if (result.success) return 200;

  switch (result.error?.code) {
    case 'INTELLIGENCE_INVALID_REQUEST':
      return 400;
    case 'INTELLIGENCE_AUTH_FAILED':
      return 502;
    case 'INTELLIGENCE_TIMEOUT':
    case 'INTELLIGENCE_UNAVAILABLE':
    case 'INTELLIGENCE_NOT_CONFIGURED':
      return 503;
    default:
      return 502;
  }
}

function sendGatewayResult(res, result) {
  return res.status(gatewayStatus(result)).json(result);
}

exports.rebuildBusinessState = async (req, res, next) => {
  try {
    const { organization_id: organizationId, organizationId: camelCaseId } = req.body || {};
    const result = await rebuildBusinessState({
      organizationId: organizationId || camelCaseId,
      correlationId: req.get('x-correlation-id'),
    });

    return sendGatewayResult(res, result);
  } catch (error) {
    return next(error);
  }
};

exports.evaluateRecommendationOutcomes = async (req, res, next) => {
  try {
    const rawLimit = req.body?.limit ?? 100;
    const limit = typeof rawLimit === 'string' && rawLimit.trim() !== ''
      ? Number(rawLimit)
      : rawLimit;

    const result = await evaluateRecommendationOutcomes({
      limit,
      correlationId: req.get('x-correlation-id'),
    });

    return sendGatewayResult(res, result);
  } catch (error) {
    return next(error);
  }
};