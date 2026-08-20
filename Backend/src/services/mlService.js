/**
 * Revluma ML Service — Python Intelligence Gateway
 *
 * The ONLY Node.js module that communicates with the Python intelligence service.
 * Controllers must NEVER call Python directly.
 * Routes must NEVER call Python directly.
 * Frontend must NEVER communicate with Python directly.
 *
 * Security:
 *   - ML_INTERNAL_KEY is server-side only, never logged, never in responses
 *   - PYTHON_SERVICE_URL is server-side only, never exposed to browser
 *   - Correlation IDs propagate across the Node → Python boundary
 *
 * Reliability:
 *   - Strict timeout enforced (default 15s, configurable)
 *   - Structured error types returned — never throws raw Python errors to callers
 *   - Response schema validated before returning to controller
 *   - Never fabricates an intelligence response on failure
 */

const axios   = require('axios');
const logger  = require('../utils/logger');

// ── Configuration ─────────────────────────────────────────────────────────────

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL;
const ML_INTERNAL_KEY    = process.env.ML_INTERNAL_KEY;
const TIMEOUT_MS         = parseInt(process.env.ML_TIMEOUT_MS || '15000', 10);
const CONTRACT_VERSION   = '1.0';

// Warn at startup — do not crash (server may start before Python is ready)
if (!PYTHON_SERVICE_URL) {
  logger.warn('ml_service_config_missing', {
    missing: 'PYTHON_SERVICE_URL',
    note: 'Rev Intelligence will be unavailable until this is set.',
  });
}
if (!ML_INTERNAL_KEY) {
  logger.warn('ml_service_config_missing', {
    missing: 'ML_INTERNAL_KEY',
    note: 'Rev Intelligence will be unavailable until this is set.',
  });
}

// ── Error codes ───────────────────────────────────────────────────────────────

const ML_ERRORS = {
  NOT_CONFIGURED:    'INTELLIGENCE_NOT_CONFIGURED',
  UNAVAILABLE:       'INTELLIGENCE_UNAVAILABLE',
  TIMEOUT:           'INTELLIGENCE_TIMEOUT',
  INVALID_RESPONSE:  'INTELLIGENCE_INVALID_RESPONSE',
  AUTH_FAILED:       'INTELLIGENCE_AUTH_FAILED',
};

// ── Required fields in a valid /orchestrate response ─────────────────────────
const REQUIRED_RESPONSE_FIELDS = [
  'situation', 'insight', 'implication',
  'recommendation', 'confidence_score', 'actions',
];

// ── Python request builder ────────────────────────────────────────────────────

function buildOrchestrateRequest({
  organizationId,
  userId,
  message,
  conversationId,
  correlationId,
}) {
  return {
    organization_id:  organizationId,
    user_id:          userId,
    message:          message.trim().slice(0, 2000),
    conversation_id:  conversationId || null,
    contract_version: CONTRACT_VERSION,
    correlation_id:   correlationId,
  };
}

// ── Response validator ────────────────────────────────────────────────────────

function validateOrchestrateResponse(data) {
  if (!data || typeof data !== 'object') return false;

  for (const field of REQUIRED_RESPONSE_FIELDS) {
    if (!(field in data)) return false;
  }

  if (typeof data.confidence_score !== 'number') return false;
  if (data.confidence_score < 0 || data.confidence_score > 1) return false;
  if (!Array.isArray(data.actions)) return false;

  // Truncate any overlong fields (defence against malformed upstream response)
  const TEXT_FIELDS = ['situation', 'insight', 'implication', 'recommendation'];
  for (const f of TEXT_FIELDS) {
    if (typeof data[f] === 'string' && data[f].length > 2000) {
      data[f] = data[f].slice(0, 2000);
    }
  }

  return true;
}

// ── Main orchestrate function ─────────────────────────────────────────────────

/**
 * Sends a merchant message to the Python intelligence service and returns
 * the structured 6-part Rev response.
 *
 * Never throws. Always returns { success, data?, error? }.
 *
 * @param {Object} params
 * @param {string} params.organizationId   - from authenticated JWT/DB lookup
 * @param {string} params.userId           - from authenticated JWT
 * @param {string} params.message          - sanitised merchant message
 * @param {string|null} params.conversationId
 * @param {string} params.correlationId    - propagated from controller
 * @returns {Promise<{success: boolean, data?: Object, error?: {code: string, message: string}}>}
 */
async function orchestrate({ organizationId, userId, message, conversationId, correlationId }) {
  const startTime = Date.now();

  // ── Guard: configuration must be present ──────────────────────────────────
  if (!PYTHON_SERVICE_URL || !ML_INTERNAL_KEY) {
    logger.error('ml_orchestrate_not_configured', {
      correlationId,
      missing: !PYTHON_SERVICE_URL ? 'PYTHON_SERVICE_URL' : 'ML_INTERNAL_KEY',
    });
    return {
      success: false,
      error: {
        code: ML_ERRORS.NOT_CONFIGURED,
        message: 'Rev Intelligence is not configured. Contact support.',
      },
    };
  }

  const requestBody = buildOrchestrateRequest({
    organizationId,
    userId,
    message,
    conversationId,
    correlationId,
  });

  logger.info('ml_orchestrate_request', {
    correlationId,
    orgId:          organizationId,
    conversationId: conversationId || 'new',
    messageLength:  message.length,
  });

  let response;
  try {
    response = await axios.post(
      `${PYTHON_SERVICE_URL}/orchestrate`,
      requestBody,
      {
        timeout: TIMEOUT_MS,
        headers: {
          'Content-Type':  'application/json',
          'X-Internal-Key': ML_INTERNAL_KEY,
          'X-Correlation-ID': correlationId,
          'X-Contract-Version': CONTRACT_VERSION,
        },
        // Never allow redirects for internal service calls
        maxRedirects: 0,
        validateStatus: (status) => status < 500, // don't throw on 4xx
      }
    );
  } catch (err) {
    const latencyMs = Date.now() - startTime;

    if (err.code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      logger.error('ml_orchestrate_timeout', {
        correlationId,
        orgId:     organizationId,
        timeoutMs: TIMEOUT_MS,
        latencyMs,
      });
      return {
        success: false,
        error: {
          code: ML_ERRORS.TIMEOUT,
          message: 'Rev Intelligence took too long to respond. Please try again.',
        },
      };
    }

    logger.error('ml_orchestrate_unavailable', {
      correlationId,
      orgId:     organizationId,
      error:     err.message,
      code:      err.code,
      latencyMs,
    });
    return {
      success: false,
      error: {
        code: ML_ERRORS.UNAVAILABLE,
        message: 'Rev Intelligence is temporarily unavailable. Please try again in a moment.',
      },
    };
  }

  const latencyMs = Date.now() - startTime;

  // ── Handle Python-level errors ────────────────────────────────────────────
  if (response.status === 401 || response.status === 403) {
    logger.error('ml_orchestrate_auth_failed', {
      correlationId,
      status: response.status,
    });
    return {
      success: false,
      error: {
        code: ML_ERRORS.AUTH_FAILED,
        message: 'Internal service authentication failed.',
      },
    };
  }

  const data = response.data;

  // Python returned success: false with an error body
  if (data && data.success === false) {
    logger.warn('ml_orchestrate_python_error', {
      correlationId,
      orgId:    organizationId,
      warnings: data.warnings,
      latencyMs,
    });
    return {
      success: false,
      error: {
        code: ML_ERRORS.UNAVAILABLE,
        message: 'Rev Intelligence could not process this request. Please try again.',
      },
    };
  }

  // ── Validate response schema ───────────────────────────────────────────────
  if (!validateOrchestrateResponse(data)) {
    logger.error('ml_orchestrate_invalid_response', {
      correlationId,
      orgId:        organizationId,
      receivedKeys: data ? Object.keys(data) : 'null',
      latencyMs,
    });
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_RESPONSE,
        message: 'Rev returned an unexpected response format. Please try again.',
      },
    };
  }

  logger.info('ml_orchestrate_success', {
    correlationId,
    orgId:          organizationId,
    conversationId: data.conversation_id,
    agentsUsed:     data.agents_used,
    stateAgeMins:   data.business_state_age_minutes,
    pythonLatencyMs: latencyMs,
    warnings:       data.warnings?.length || 0,
  });

  return { success: true, data };
}

// ── Health check ──────────────────────────────────────────────────────────────

async function checkPythonHealth() {
  if (!PYTHON_SERVICE_URL) return { healthy: false, reason: 'PYTHON_SERVICE_URL not set' };
  try {
    const res = await axios.get(`${PYTHON_SERVICE_URL}/health`, { timeout: 5000 });
    return { healthy: res.status === 200, status: res.status };
  } catch (err) {
    return { healthy: false, reason: err.message };
  }
}

module.exports = { orchestrate, checkPythonHealth, ML_ERRORS };