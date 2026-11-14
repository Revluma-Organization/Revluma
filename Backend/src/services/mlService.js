/**
 * Revluma ML Service — Python Intelligence Gateway
 *
 * The ONLY Node.js module that communicates with the Python intelligence service.
 *
 * Controllers must NEVER call Python directly.
 * Routes must NEVER call Python directly.
 * Frontend must NEVER communicate with Python directly.
 *
 * Security:
 *   - ML_INTERNAL_KEY is server-side only.
 *   - PYTHON_SERVICE_URL is server-side only.
 *   - Correlation IDs propagate across Node → Python.
 *
 * Reliability:
 *   - Strict timeout enforced.
 *   - Structured errors returned.
 *   - No raw Python errors exposed to callers.
 *   - No fabricated intelligence responses.
 */

const axios = require('axios');
const logger = require('../utils/logger');
const revMetrics = require('./revOperationalMetrics');
const { createSseParser } = require('./revStream');
const { EVIDENCE_SCHEMA_VERSION, validateEvidenceCollection } = require('./revEvidenceContract');
const {
  CLAIM_CONTRACT_VERSION,
  validateClaim: validateRevClaim,
} = require('./revEpistemics');
const { assertResponseGuardrails } = require('./revClaimGuardrails');
const { validateInvestigationOutcome } = require('./revInvestigationOutcomes');
const { validateSpecialistExecution } = require('./revSpecialists');
const { validateQuestionOrchestration } = require('./revQuestionOrchestration');
const { validateResponseAdaptation } = require('./revResponseAdaptation');
const { validateRecommendationBoundary } = require('./revRecommendations');
const {
  TIMEOUT_POLICY_MS, safeId, safeFailure, normalizePythonFailure,
} = require('./revFailureContract');

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL;
const ML_INTERNAL_KEY = process.env.ML_INTERNAL_KEY;

const TIMEOUT_MS = parseInt(
  process.env.ML_TIMEOUT_MS || '45000',
  10
);

const CONTRACT_VERSION = '1.0';

/*
 * These internal endpoint paths should be confirmed by the AI/Python team.
 * Keeping them configurable prevents us from hard-coding an incorrect route.
 */
const INTERNAL_ENDPOINTS = {
  RFM_SYNC: '/internal/rfm-sync',
  MORNING_BRIEFINGS: '/internal/morning-briefings',
  BUSINESS_STATE: '/internal/business-state/rebuild',
  RECOMMENDATION_OUTCOMES:
    '/internal/recommendation-outcomes/evaluate',
  FEATURES: '/internal/features/compute',
  AUTOMATION: '/internal/automation/run',
};

if (!PYTHON_SERVICE_URL) {
  logger.warn(
    'PYTHON_SERVICE_URL is not configured'
  );
}

if (!ML_INTERNAL_KEY) {
  logger.warn(
    'ML_INTERNAL_KEY is not configured'
  );
}

/* -------------------------------------------------------------------------- */
/* ML ERROR TYPES                                                             */
/* -------------------------------------------------------------------------- */

const ML_ERRORS = {
  NOT_CONFIGURED: 'INTELLIGENCE_NOT_CONFIGURED',
  UNAVAILABLE: 'INTELLIGENCE_UNAVAILABLE',
  TIMEOUT: 'INTELLIGENCE_TIMEOUT',
  INVALID_RESPONSE: 'INTELLIGENCE_INVALID_RESPONSE',
  AUTH_FAILED: 'INTELLIGENCE_AUTH_FAILED',
  INVALID_REQUEST: 'INTELLIGENCE_INVALID_REQUEST',
};

/* -------------------------------------------------------------------------- */
/* ORCHESTRATOR CONTRACT                                                      */
/* -------------------------------------------------------------------------- */

const VALID_TRIGGER_TYPES = [
  'conversation',
  'alert',
  'scheduler',
];

const VALID_TRIGGER_PRIORITIES = [
  'low',
  'normal',
  'high',
  'critical',
];

const VALID_RESPONSE_TYPES = [
  'chat',
  'conversational',
  'analysis',
  'capability',
  'direct_answer',
  'clarification',
  'knowledge',
  'action_plan',
  'error',
];

/* -------------------------------------------------------------------------- */
/* CHURN CONTRACT                                                             */
/* -------------------------------------------------------------------------- */

const CHURN_FEATURES = [
  'past_orders_total',
  'days_since_last_purchase',
  'avg_order_value',
  'purchase_frequency_trend',
  'rfm_recency_score',
  'rfm_frequency_score',
  'rfm_monetary_score',
  'historical_aov_trend',
  'email_open_rate_30d',
  'email_open_rate_90d',
  'email_open_rate_delta',
  'sms_click_rate_30d',
  'site_visit_frequency_30d',
  'site_visit_frequency_90d',
  'site_visit_delta',
  'browse_to_cart_conversion_trend',
  'coupon_dependency_score',
  'return_rate',
  'support_contact_frequency_90d',
  'discount_seeking_escalation',
  'unsubscribe_risk_score',
];

const CHURN_RESPONSE_MAPPING = {
  offer_required: 'churn_offer_required',
  escalate_to_human: 'churn_escalate_to_human',
  fallback: 'churn_score_fallback',
  model_version: 'churn_model_version',
};

/* -------------------------------------------------------------------------- */
/* IMAGE CONTRACT                                                             */
/* -------------------------------------------------------------------------- */

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/* -------------------------------------------------------------------------- */
/* SEND-TIME CONTRACT                                                         */
/* -------------------------------------------------------------------------- */

const SEND_TIME_FIELDS = [
  'channel',
  'recovery_action',
  'cart_value_tier',
  'customer_timezone_offset',
  'historical_open_probabilities',
  'history_data_points',
  'days_since_last_purchase',
  'failed_payment_attempt',
  'risk_score',
  'sequence_message_number',
  'previous_message_sent_at',
  'previous_message_opened',
  'previous_message_clicked',
  'last_sms_sent_at',
  'secondary_channel',
];

/* -------------------------------------------------------------------------- */
/* HELPERS                                                                    */
/* -------------------------------------------------------------------------- */

function getCorrelationId(correlationId) {
  // Correlation is a UUID contract shared with browser submission idempotency.
  return safeId(correlationId);
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function serializedSize(value) {
  try {
    return Buffer.byteLength(
      JSON.stringify(value),
      'utf8'
    );
  } catch {
    return Infinity;
  }
}

/**
 * Shared Node → Python request gateway.
 *
 * This is the only function that should actually communicate
 * with the Python intelligence service.
 */
async function pythonRequest({
  method = 'POST',
  path,
  body,
  correlationId,
  executionId,
  timeout = TIMEOUT_MS,
  extraHeaders = {},
}) {
  const requestCorrelationId = getCorrelationId(
    correlationId || body?.correlation_id || body?.context_payload?.correlation_id,
  );
  const requestExecutionId = safeId(
    executionId || body?.execution_id || body?.context_payload?.execution_id,
  );
  const startTime = Date.now();

  if (!PYTHON_SERVICE_URL || !ML_INTERNAL_KEY) {
    revMetrics.record('rev_provider_failures_total', 1, { category: 'provider_unavailable' });
    const failure = safeFailure('provider_unavailable', 'node_python_transport', {
      correlationId: requestCorrelationId, executionId: requestExecutionId,
    });
    return {
      success: false,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      error: {
        code: ML_ERRORS.NOT_CONFIGURED,
        failure,
        message: 'Rev Intelligence is not configured. Contact support.',
      },
    };
  }

  if (!path) {
    return {
      success: false,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        failure: safeFailure('invalid_request', 'node_python_transport', {
          correlationId: requestCorrelationId, executionId: requestExecutionId,
        }),
        message: 'Python intelligence endpoint is not configured.',
      },
    };
  }
  if (body && typeof body === 'object') {
    body.correlation_id = requestCorrelationId;
    body.execution_id = requestExecutionId;
    body.context_payload = {
      ...(body.context_payload || {}),
      correlation_id: requestCorrelationId,
      execution_id: requestExecutionId,
      execution_policy: { overall_timeout_ms: TIMEOUT_POLICY_MS.overallInvestigation - 5000 },
    };
  }

  try {
    const response = await axios({
      method,
      url: `${PYTHON_SERVICE_URL}${path}`,
      data: body,
      timeout,
      maxRedirects: 0,

      validateStatus: (status) => status < 600,

      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': ML_INTERNAL_KEY,
        'X-Correlation-ID': requestCorrelationId,
        'X-Execution-ID': requestExecutionId,
        'X-Contract-Version': CONTRACT_VERSION,
        ...extraHeaders,
      },
    });

    const latencyMs = Date.now() - startTime;

    logger.info(
      {
        operation: path,
        status: response.status,
        latencyMs,
        correlationId: requestCorrelationId,
      },
      'ML service request completed'
    );

    if (
      response.status === 401 ||
      response.status === 403
    ) {
      return {
        success: false,
        correlationId: requestCorrelationId,
        executionId: requestExecutionId,
        error: {
          code: ML_ERRORS.AUTH_FAILED,
          failure: safeFailure('authorization_failed', 'node_python_transport', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
          message:
            'Intelligence service authentication failed.',
        },
      };
    }

    if (response.status >= 400) {
      const detail = response.data?.detail && typeof response.data.detail === 'object'
        ? response.data.detail : {};
      const fallback = safeFailure(
        response.status === 422 ? 'schema_validation_failed' : response.status >= 500 ? 'provider_unavailable' : 'invalid_request',
        'node_python_transport', { correlationId: requestCorrelationId, executionId: requestExecutionId });
      const failure = normalizePythonFailure(detail.failure, fallback, requestCorrelationId, requestExecutionId);
      if (response.status >= 500) revMetrics.record('rev_provider_failures_total', 1, { category: failure.category });
      const providerFailure = detail.code === 'PROVIDER_FAILURE';
      return {
        success: false,
        correlationId: requestCorrelationId,
        executionId: requestExecutionId,
        error: {
          code: providerFailure ? 'PROVIDER_FAILURE' : response.status === 422 ? ML_ERRORS.INVALID_RESPONSE : ML_ERRORS.UNAVAILABLE,
          failure,
          retryable: providerFailure ? failure.retryable : undefined,
          message: providerFailure
            ? (failure.retryable
              ? 'Rev could not complete this response because its configured AI providers remained unavailable within the retry budget. Please try again shortly.'
              : 'Rev could not complete this response because its configured AI provider rejected the request. Please contact support.')
            : response.status === 422
              ? 'Intelligence response failed validation.'
              : response.status >= 500 ? 'Intelligence service is temporarily unavailable.' : 'Intelligence service request failed.',
        },
      };
    }

    return {
      success: true,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      data: response.data,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    if (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT'
    ) {
      revMetrics.record('rev_provider_failures_total', 1, { category: 'timeout' });
      logger.warn(
        {
          operation: path,
          latencyMs,
          correlationId: requestCorrelationId,
          errorType: 'timeout',
        },
        'ML service request timed out'
      );

      return {
        success: false,
        correlationId: requestCorrelationId,
        executionId: requestExecutionId,
        error: {
          code: ML_ERRORS.TIMEOUT,
          failure: safeFailure('timeout', 'node_python_transport', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
          message:
            'Intelligence service timed out.',
        },
        latencyMs,
      };
    }

    revMetrics.record('rev_provider_failures_total', 1, { category: 'connection_failed' });
    logger.warn(
      {
        operation: path,
        latencyMs,
        correlationId: requestCorrelationId,
        executionId: requestExecutionId,
        errorType: error.code || 'request_error',
      },
      'ML service request failed'
    );

    return {
      success: false,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      error: {
        code: ML_ERRORS.UNAVAILABLE,
        failure: safeFailure('connection_failed', 'node_python_transport', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
        message:
          'Intelligence service is unavailable.',
      },
      latencyMs,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* IMAGE VALIDATION                                                           */
/* -------------------------------------------------------------------------- */

function validateImageInput(
  imageBase64,
  imageMediaType
) {
  const hasBase64 =
    imageBase64 !== undefined &&
    imageBase64 !== null &&
    imageBase64 !== '';

  const hasMediaType =
    imageMediaType !== undefined &&
    imageMediaType !== null &&
    imageMediaType !== '';

  if (!hasBase64 && !hasMediaType) {
    return {
      valid: true,
    };
  }

  /*
   * image_base64 and image_media_type must always be supplied together.
   */
  if (!hasBase64 || !hasMediaType) {
    return {
      valid: false,
      message:
        'image_base64 and image_media_type must be supplied together.',
    };
  }

  if (!ALLOWED_IMAGE_TYPES.includes(imageMediaType)) {
    return {
      valid: false,
      message:
        'Unsupported image media type.',
    };
  }

  /*
   * Data URL wrappers are deliberately rejected.
   * Example:
   * data:image/png;base64,...
   */
  if (
    typeof imageBase64 !== 'string' ||
    imageBase64.startsWith('data:')
  ) {
    return {
      valid: false,
      message:
        'image_base64 must contain raw base64 without a data URL wrapper.',
    };
  }

  /*
   * Validate base64 characters.
   */
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(imageBase64)) {
    return {
      valid: false,
      message:
        'Invalid base64 image data.',
    };
  }

  let decodedBytes;

  try {
    const buffer = Buffer.from(
      imageBase64,
      'base64'
    );

    decodedBytes = buffer.length;
  } catch {
    return {
      valid: false,
      message:
        'Unable to decode image data.',
    };
  }

  if (decodedBytes <= 0) {
    return {
      valid: false,
      message:
        'Image data is empty.',
    };
  }

  if (decodedBytes > MAX_IMAGE_BYTES) {
    return {
      valid: false,
      message:
        'Image exceeds the 8 MiB decoded size limit.',
    };
  }

  return {
    valid: true,
  };
}

/* -------------------------------------------------------------------------- */
/* ORCHESTRATOR                                                               */
/* -------------------------------------------------------------------------- */

function buildOrchestrateRequest({
  organizationId,
  userId,
  message,
  conversationId,
  correlationId,
  executionId,
  triggerType = 'conversation',
  triggerPriority = 'normal',
  contextPayload = {},
  imageBase64,
  imageMediaType,
}) {
  const request = {
    organization_id: organizationId,
    user_id: userId,
    execution_id: safeId(executionId),

    conversation_id:
      conversationId || null,

    message:
      typeof message === 'string'
        ? message.trim().slice(0, 2000)
        : '',

    trigger_type: triggerType,
    trigger_priority: triggerPriority,

    context_payload: contextPayload,

    contract_version: CONTRACT_VERSION,
    correlation_id: correlationId,
  };

  if (imageBase64 && imageMediaType) {
    request.image_base64 = imageBase64;
    request.image_media_type = imageMediaType;
  }

  return request;
}

function validateOrchestrateRequest({
  organizationId,
  userId,
  message,
  triggerType,
  triggerPriority,
  contextPayload,
  imageBase64,
  imageMediaType,
}) {
  if (typeof organizationId !== 'string' || !organizationId.trim()) {
    return {
      valid: false,
      message:
        'organizationId is required.',
    };
  }

  if (typeof userId !== 'string' || !userId.trim()) {
    return {
      valid: false,
      message:
        'userId is required.',
    };
  }

  if (
    typeof message !== 'string' ||
    !message.trim()
  ) {
    return {
      valid: false,
      message:
        'message is required.',
    };
  }

  if (message.trim().length > 2000) {
    return {
      valid: false,
      message:
        'message must not exceed 2000 characters.',
    };
  }

  if (
    !VALID_TRIGGER_TYPES.includes(triggerType)
  ) {
    return {
      valid: false,
      message:
        'Invalid trigger_type.',
    };
  }

  if (
    !VALID_TRIGGER_PRIORITIES.includes(
      triggerPriority
    )
  ) {
    return {
      valid: false,
      message:
        'Invalid trigger_priority.',
    };
  }

  if (!isPlainObject(contextPayload)) {
    return {
      valid: false,
      message:
        'context_payload must be an object.',
    };
  }

  /*
   * Maximum serialized context payload:
   * 16 KiB.
   */
  if (serializedSize(contextPayload) > 16 * 1024) {
    return {
      valid: false,
      message:
        'context_payload exceeds the 16 KiB limit.',
    };
  }

  const imageValidation =
    validateImageInput(
      imageBase64,
      imageMediaType
    );

  if (!imageValidation.valid) {
    return imageValidation;
  }

  return {
    valid: true,
  };
}

function validateOrchestrateResponse(data) {
  if (!isPlainObject(data) || data.success === false) {
    return false;
  }

  if (
    !VALID_RESPONSE_TYPES.includes(
      data.response_type
    )
  ) {
    return false;
  }

  /*
   * Every valid orchestrator response needs these.
   */
  if (
    typeof data.conversation_id !== 'string' || !data.conversation_id.trim() ||
    typeof data.message_id !== 'string' || !data.message_id.trim()
  ) {
    return false;
  }

  /*
   * Analysis responses have additional required fields.
   */
  if (data.response_type === 'analysis') {
    const requiredAnalysisFields = [
      'situation',
      'insight',
      'implication',
      'recommendation',
    ];

    for (const field of requiredAnalysisFields) {
      if (typeof data[field] !== 'string' || !data[field].trim()) {
        return false;
      }
    }

    if (
      data.actions !== undefined &&
      (!Array.isArray(data.actions) || data.actions.length > 20)
    ) {
      return false;
    }
  }

  return true;
}

async function orchestrate({
  organizationId,
  userId,
  message,
  conversationId,
  correlationId,
  executionId,
  triggerType = 'conversation',
  triggerPriority = 'normal',
  contextPayload = {},
  imageBase64,
  imageMediaType,
}) {
  const requestCorrelationId = getCorrelationId(correlationId);
  const requestExecutionId = safeId(executionId);

  const validation =
    validateOrchestrateRequest({
      organizationId,
      userId,
      message,
      triggerType,
      triggerPriority,
      contextPayload,
      imageBase64,
      imageMediaType,
    });

  if (!validation.valid) {
    return {
      success: false,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        failure: safeFailure('invalid_request', 'request_validation', {
          correlationId: requestCorrelationId, executionId: requestExecutionId,
        }),
        message: validation.message,
      },
    };
  }

  const requestBody =
    buildOrchestrateRequest({
      organizationId,
      userId,
      message,
      conversationId,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      triggerType,
      triggerPriority,
      contextPayload: {
        ...contextPayload,
        correlation_id: requestCorrelationId,
        execution_id: requestExecutionId,
      },
      imageBase64,
      imageMediaType,
    });

  const result =
    await pythonRequest({
      path: '/orchestrate',
      body: requestBody,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
    });

  if (!result.success) {
    return result;
  }

  if (
    result.data &&
    result.data.success === false
  ) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.UNAVAILABLE,
        message:
          'Intelligence service could not process the request.',
      },
    };
  }

  if (
    !validateOrchestrateResponse(
      result.data
    )
  ) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_RESPONSE,
        message:
          'Intelligence service returned an invalid response.',
      },
    };
  }

  result.data.correlation_id = result.data.correlation_id || requestCorrelationId;
  result.data.execution_id = result.data.execution_id || requestExecutionId;
  result.data.execution_metadata = result.data.execution_metadata || {
    correlation_id: requestCorrelationId,
    execution_id: requestExecutionId,
    outcome: 'success',
  };
  return {
    success: true,
    data: result.data,
  };
}

/* -------------------------------------------------------------------------- */
/* RFM SYNC                                                                   */
/* -------------------------------------------------------------------------- */

async function rfmSync({
  storeId,
  correlationId,
}) {
  if (!storeId) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message:
          'storeId is required.',
      },
    };
  }

  return pythonRequest({
    path: INTERNAL_ENDPOINTS.RFM_SYNC,
    body: {
      store_id: storeId,
    },
    correlationId,
  });
}

/* -------------------------------------------------------------------------- */
/* FEATURE COMPUTATION AND CHECKOUT MODELS                                    */
/* -------------------------------------------------------------------------- */

async function computeFeatures({ customerId = null, sessionEvents, correlationId }) {
  if (!Array.isArray(sessionEvents) || sessionEvents.length < 1 || sessionEvents.length > 1000) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message: 'sessionEvents must contain between 1 and 1000 events.',
      },
    };
  }

  const result = await pythonRequest({
    path: INTERNAL_ENDPOINTS.FEATURES,
    body: { customer_id: customerId, session_events: sessionEvents },
    correlationId,
  });
  if (!result.success) return result;
  if (!isPlainObject(result.data) || !isPlainObject(result.data.features)) {
    return {
      success: false,
      error: { code: ML_ERRORS.INVALID_RESPONSE, message: 'Invalid feature response.' },
    };
  }
  return result;
}

async function predictAbandonment({ features, customerId, merchantId, correlationId }) {
  if (!isPlainObject(features)) {
    return {
      success: false,
      error: { code: ML_ERRORS.INVALID_REQUEST, message: 'Abandonment features are required.' },
    };
  }
  return pythonRequest({
    path: '/predict/abandonment-probability',
    body: features,
    correlationId,
    extraHeaders: {
      ...(customerId ? { 'X-Customer-ID': customerId } : {}),
      ...(merchantId ? { 'X-Merchant-ID': merchantId } : {}),
    },
  });
}

async function predictSensitivity({ features, customerId, merchantId, correlationId }) {
  if (!isPlainObject(features)) {
    return {
      success: false,
      error: { code: ML_ERRORS.INVALID_REQUEST, message: 'Sensitivity features are required.' },
    };
  }
  return pythonRequest({
    path: '/predict/shopper-sensitivity',
    body: features,
    correlationId,
    extraHeaders: {
      ...(customerId ? { 'X-Customer-ID': customerId } : {}),
      ...(merchantId ? { 'X-Merchant-ID': merchantId } : {}),
    },
  });
}

async function predictOfferValue({ features, customerId, merchantId, correlationId }) {
  if (!isPlainObject(features)) {
    return {
      success: false,
      error: { code: ML_ERRORS.INVALID_REQUEST, message: 'Offer features are required.' },
    };
  }
  return pythonRequest({
    path: '/predict/offer-value',
    body: features,
    correlationId,
    extraHeaders: {
      ...(customerId ? { 'X-Customer-ID': customerId } : {}),
      ...(merchantId ? { 'X-Merchant-ID': merchantId } : {}),
    },
  });
}

/* -------------------------------------------------------------------------- */
/* CHURN RISK                                                                 */
/* -------------------------------------------------------------------------- */

// avg_order_value is derived from the stored lifetime value, and financial
// integrity deliberately sends null when that value cannot be verified
// against a single labelled currency (unlabelled or mixed-currency totals
// must never be read as USD). Null means "unknown money", not "bad feature":
// Python's inference layer scores it as missing, and escalation stays off
// because an unverified LTV can never justify a human hand-off. Every other
// feature remains a required finite number.
const NULLABLE_CHURN_FEATURES = new Set(['avg_order_value']);

function validateChurnFeatures(features) {
  if (!isPlainObject(features)) {
    return {
      valid: false,
      message:
        'Churn features must be an object.',
    };
  }

  for (const feature of CHURN_FEATURES) {
    if (!(feature in features)) {
      return {
        valid: false,
        message:
          `Missing churn feature: ${feature}`,
      };
    }

    if (
      features[feature] === null &&
      NULLABLE_CHURN_FEATURES.has(feature)
    ) {
      continue;
    }

    if (
      typeof features[feature] !== 'number' ||
      !Number.isFinite(features[feature])
    ) {
      return {
        valid: false,
        message:
          `Invalid churn feature: ${feature}`,
      };
    }
  }

  return {
    valid: true,
  };
}

function mapChurnResponse(data) {
  if (!isPlainObject(data)) {
    return null;
  }

  return {
    churn_probability:
      data.churn_probability,

    churn_tier:
      data.churn_tier,

    win_back_urgency:
      data.win_back_urgency,

    primary_churn_signal:
      data.primary_churn_signal,

    engagement_decay_score:
      data.engagement_decay_score,

    recommended_channel:
      data.recommended_channel,

    churn_offer_required:
      data.offer_required,

    churn_escalate_to_human:
      data.escalate_to_human,

    churn_score_fallback:
      data.fallback,

    churn_model_version:
      data.model_version,
  };
}

async function predictChurnRisk({
  customerId,
  merchantId,
  features,
  correlationId,
}) {
  if (!customerId) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message:
          'customerId is required.',
      },
    };
  }

  if (!merchantId) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message:
          'merchantId is required.',
      },
    };
  }

  const validation =
    validateChurnFeatures(features);

  if (!validation.valid) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message: validation.message,
      },
    };
  }

  const result =
    await pythonRequest({
      path: '/predict/churn-risk',

      body: features,

      correlationId,

      extraHeaders: {
        'X-Customer-ID': customerId,
        'X-Merchant-ID': merchantId,
      },
    });

  if (!result.success) {
    return result;
  }

  if (!isPlainObject(result.data)) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_RESPONSE,
        message:
          'Invalid churn prediction response.',
      },
    };
  }

  return {
    success: true,
    data: mapChurnResponse(
      result.data
    ),
    rawData: result.data,
  };
}

/* -------------------------------------------------------------------------- */
/* SEND-TIME PREDICTION                                                       */
/* -------------------------------------------------------------------------- */

function validateSendTimePayload(payload) {
  if (!isPlainObject(payload)) {
    return {
      valid: false,
      message:
        'Send-time payload must be an object.',
    };
  }

  for (const field of SEND_TIME_FIELDS) {
    /*
     * Some fields can legitimately be null.
     * We only require that the property exists.
     */
    if (!(field in payload)) {
      return {
        valid: false,
        message:
          `Missing send-time field: ${field}`,
      };
    }
  }

  const probabilities =
    payload.historical_open_probabilities;

  /*
   * Contract:
   * - empty/omitted OR
   * - exactly 24 values
   */
  if (
    probabilities !== undefined &&
    probabilities !== null
  ) {
    if (
      !Array.isArray(probabilities)
    ) {
      return {
        valid: false,
        message:
          'historical_open_probabilities must be an array.',
      };
    }

    if (
      probabilities.length !== 0 &&
      probabilities.length !== 24
    ) {
      return {
        valid: false,
        message:
          'historical_open_probabilities must contain exactly 24 values or be empty.',
      };
    }

    for (const probability of probabilities) {
      if (
        typeof probability !== 'number' ||
        !Number.isFinite(probability) ||
        probability < 0 ||
        probability > 1
      ) {
        return {
          valid: false,
          message:
            'Historical open probabilities must be numbers between 0 and 1.',
        };
      }
    }
  }

  if (
    typeof payload.history_data_points !==
      'number' ||
    !Number.isFinite(
      payload.history_data_points
    )
  ) {
    return {
      valid: false,
      message:
        'history_data_points must be a finite number.',
    };
  }

  return {
    valid: true,
  };
}

async function predictSendTime({
  payload,
  customerId,
  merchantId,
  correlationId,
}) {
  const validation =
    validateSendTimePayload(
      payload
    );

  if (!validation.valid) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message: validation.message,
      },
    };
  }

  return pythonRequest({
    path: '/predict/send-time',
    body: payload,
    correlationId,
    extraHeaders: {
      ...(customerId ? { 'X-Customer-ID': customerId } : {}),
      ...(merchantId ? { 'X-Merchant-ID': merchantId } : {}),
    },
  });
}

/* -------------------------------------------------------------------------- */
/* MORNING BRIEFINGS                                                          */
/* -------------------------------------------------------------------------- */

async function generateMorningBriefings({
  organizationId,
  correlationId,
}) {
  const body = {};

  if (organizationId) {
    body.organization_id =
      organizationId;
  }

  return pythonRequest({
    path:
      INTERNAL_ENDPOINTS.MORNING_BRIEFINGS,
    body,
    correlationId,
  });
}

async function checkAlerts({ organizationId, userIds = [], correlationId }) {
  if (!organizationId || !Array.isArray(userIds)) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message: 'organizationId and userIds are required.',
      },
    };
  }

  return pythonRequest({
    path: '/api/alerts/check',
    body: { organization_id: organizationId, user_ids: userIds },
    correlationId,
  });
}

/* -------------------------------------------------------------------------- */
/* BUSINESS STATE                                                              */
/* -------------------------------------------------------------------------- */

async function rebuildBusinessState({
  organizationId,
  correlationId,
}) {
  if (!organizationId) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message: 'organizationId is required.',
      },
    };
  }

  return pythonRequest({
    path: INTERNAL_ENDPOINTS.BUSINESS_STATE,
    body: {
      organization_id: organizationId,
    },
    correlationId,
  });
}

/* -------------------------------------------------------------------------- */
/* RECOMMENDATION OUTCOMES                                                    */
/* -------------------------------------------------------------------------- */

async function evaluateRecommendationOutcomes({
  limit = 100,
  correlationId,
}) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message: 'limit must be an integer between 1 and 100.',
      },
    };
  }

  return pythonRequest({
    path: INTERNAL_ENDPOINTS.RECOMMENDATION_OUTCOMES,
    body: {
      limit,
    },
    correlationId,
  });
}

async function runIntelligenceAutomation({ correlationId }) {
  return pythonRequest({
    path: INTERNAL_ENDPOINTS.AUTOMATION,
    body: {},
    correlationId,
  });
}

/* -------------------------------------------------------------------------- */
/* PYTHON HEALTH                                                              */
/* -------------------------------------------------------------------------- */

async function checkPythonHealth() {
  if (!PYTHON_SERVICE_URL) {
    return {
      healthy: false,
      reason:
        'PYTHON_SERVICE_URL not set',
    };
  }

  const startTime = Date.now();

  try {
    const response =
      await axios.get(
        `${PYTHON_SERVICE_URL}/health`,
        {
          timeout: 5000,
          maxRedirects: 0,
        }
      );

    const data = response.data;
    const allowedStatuses = new Set(
      String(process.env.PYTHON_ALLOWED_MODEL_STATUSES || 'ready,beta_ready')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    );
    const modelsMissing = Array.isArray(data?.models_missing)
      ? data.models_missing
      : null;
    const healthy = response.status === 200 &&
      data?.status === 'ok' &&
      data?.models_ready === true &&
      modelsMissing?.length === 0 &&
      allowedStatuses.has(data?.model_status);

    return {
      healthy,
      status: response.status,
      modelStatus: data?.model_status || null,
      modelsReady: data?.models_ready === true,
      modelsMissing: modelsMissing || [],
      modelChannels: isPlainObject(data?.model_channels) ? data.model_channels : {},
      // Deploy verification (conversational upgrade §21): which Python build
      // is actually answering, not just whether it is healthy.
      version: typeof data?.version === 'string' ? data.version : null,
      build: typeof data?.build === 'string' ? data.build : null,
      reason: healthy ? null : 'models_not_ready',
      latencyMs:
        Date.now() - startTime,
    };
  } catch (error) {
    return {
      healthy: false,
      reason:
        error.code === 'ECONNABORTED'
          ? 'timeout'
          : 'unavailable',
      latencyMs:
        Date.now() - startTime,
    };
  }
}



/* -------------------------------------------------------------------------- */
/* REV INTELLIGENCE — INVESTIGATION GATEWAY (read-only)                       */
/* -------------------------------------------------------------------------- */

const INVESTIGATION_CONTRACT = 'rev-investigation-v1';
const STREAM_TIMEOUT_MS = parseInt(process.env.ML_STREAM_TIMEOUT_MS || String(TIMEOUT_POLICY_MS.overallInvestigation), 10);

function authorizedContextStoreIds(contextPayload) {
  const context = contextPayload?.merchant_context;
  if (!context || context.schema_version !== 'rev-merchant-context-v3') return null;
  const ids = new Set([...(context.store_ids || []), ...(context.evidence?.items || []).flatMap(item => item.store_ids || [])]);
  for (const store of context.store_health || []) if (store?.store_id) ids.add(store.store_id);
  return [...ids];
}

function validateInvestigationResponse(data, organizationId = null, storeIds = null, correlationId = null) {
  if (!isPlainObject(data) || data.success === false) return false;
  if (data.read_only !== true) return false;
  if (typeof data.text !== 'string') return false;
  if (typeof data.response_type !== 'string' || !data.response_type.trim()) return false;
  const investigation = data.investigation;
  if (!isPlainObject(investigation)) return false;
  if (typeof investigation.id !== 'string' || !investigation.id.trim()) return false;
  if (typeof investigation.intent !== 'string' || !investigation.intent.trim()) return false;
  if (typeof investigation.status !== 'string' || !investigation.status.trim()) return false;
  if (!isPlainObject(investigation.period)) return false;
  // Task 207: every investigation response carries a typed outcome. Node
  // independently verifies its contract and authenticated tenant before the
  // payload can reach JSON, SSE, persistence or history.
  if (validateInvestigationOutcome(data.investigation_outcome, organizationId).length > 0) return false;
  const evidence = data.evidence;
  if (!isPlainObject(evidence) || !Array.isArray(evidence.items)) return false;
  if (evidence.schema_version !== EVIDENCE_SCHEMA_VERSION) return false;
  if (!validateEvidenceCollection(evidence.items, { organizationId, storeIds }).valid) return false;
  const knownIds = new Set(evidence.items.map(item => item.id));
  const authorizedEvidenceIds = new Set([...knownIds, ...(evidence.comparison_items || []).map(item => item.id)]);
  if (data.orchestration !== undefined && validateQuestionOrchestration(data.orchestration, {
    organizationId, evidenceIds: authorizedEvidenceIds,
  }).length > 0) return false;
  // Task 208: selected specialists must return a complete, tenant-safe
  // execution whose facts and recommendations cite this investigation only.
  if (data.specialists !== undefined) {
    if (!Array.isArray(data.specialists)) return false;
    for (const specialist of data.specialists) {
      if (validateSpecialistExecution(specialist, {
        organizationId, evidenceIds: authorizedEvidenceIds,
      }).length > 0) return false;
    }
  }
  if (data.structured_summary !== undefined) {
    const summary = data.structured_summary;
    if (!isPlainObject(summary) || summary.contract_version !== 'rev-conversation-context-v2' ||
        summary.summary_method !== 'deterministic_bounded_projection_no_model' ||
        summary.tenant?.organization_id !== organizationId || !Array.isArray(summary.tenant?.store_ids) ||
        !['verified_findings', 'calculated_findings', 'hypotheses', 'unknowns', 'recommendations',
          'finding_history', 'evidence_references'].every(key => Array.isArray(summary[key]))) return false;
  }
  if (data.consistency !== undefined) {
    if (!isPlainObject(data.consistency) || data.consistency.contract_version !== 'rev-consistency-v1' ||
        !['new_context', 'context_changed', 'unchanged', 'evidence_changed'].includes(data.consistency.status) ||
        !Array.isArray(data.consistency.changed_fields)) return false;
  }
  if (data.reliability !== undefined) {
    if (!isPlainObject(data.reliability) || data.reliability.contract_version !== 'rev-reliability-v1' ||
        !Array.isArray(data.reliability.failures)) return false;
    data.reliability.failures = data.reliability.failures.map(failure => normalizePythonFailure(
      failure, safeFailure('internal_error', 'python_execution', { correlationId, executionId: investigation.id }), correlationId, investigation.id));
  }
  // One malformed optional recommendation must not erase valid evidence,
  // calculations, or other recommendations. The rejected record is never
  // persisted or forwarded; the independent valid subset remains typed.
  if (Array.isArray(data.recommendations)) {
    const originalCount = data.recommendations.length;
    data.recommendations = data.recommendations.filter(recommendation =>
      validateRecommendationBoundary(
        recommendation?.finding_id ? data.selected_finding : null, [recommendation],
        { organizationId, evidenceIds: authorizedEvidenceIds }).length === 0);
    if (data.recommendations.length !== originalCount) {
      data.warnings = [...(Array.isArray(data.warnings) ? data.warnings : []),
        'An invalid recommendation was excluded; independent evidence and findings were preserved.'];
      if (!data.reliability) {
        data.reliability = { contract_version: 'rev-reliability-v1', failures: [],
          fallback_used: true, partial_results_preserved: true };
      }
      data.reliability.failures.push(safeFailure('schema_validation_failed', 'recommendation_validation', {
        partial: true, fallback: true, executionId: investigation.id,
      }));
    }
  }
  if (validateRecommendationBoundary(data.selected_finding, data.recommendations || [], {
    organizationId, evidenceIds: authorizedEvidenceIds,
  }).length > 0) return false;
  if (data.facts !== undefined && !Array.isArray(data.facts)) return false;
  if ((data.facts || []).some(fact => !(fact?.evidence_ids || []).length || fact.evidence_ids.some(id => !knownIds.has(id)))) return false;
  if (data.hypotheses !== undefined && !Array.isArray(data.hypotheses)) return false;
  if ((data.hypotheses || []).some(hypothesis => hypothesis?.verified === true ||
    (hypothesis?.basis_evidence_ids || hypothesis?.evidence_ids || []).some(id => !knownIds.has(id)))) return false;
  if (data.unknowns !== undefined && !Array.isArray(data.unknowns)) return false;
  if (data.recommendations !== undefined) {
    if (!Array.isArray(data.recommendations)) return false;
    if (data.recommendations.some((rec) => rec && rec.executed === true)) return false;
  }

  // Task 204: the canonical epistemic claim contract (rev-claim-v1) is
  // re-validated at the Node boundary with the same stable error codes
  // Python uses. Claims may cite current items OR the comparison window's
  // items (a calculated observation cites one evidence record per period).
  // Restated claims (provenance follow-ups) are validated under the
  // restatement rules and are not re-derived against this response's items.
  if (data.claims !== undefined) {
    if (!Array.isArray(data.claims)) return false;
    const claimEvidence = {};
    for (const item of [...evidence.items, ...((evidence.comparison_items || []))]) {
      if (item && typeof item.id === 'string' && item.id) claimEvidence[item.id] = item;
    }
    for (const claim of data.claims) {
      if (validateRevClaim(claim, claimEvidence, { organizationId, storeIds }).length > 0) {
        return false;
      }
    }
  }
  if (data.epistemics !== undefined) {
    if (!isPlainObject(data.epistemics)) return false;
    if (data.epistemics.contract_version !== CLAIM_CONTRACT_VERSION) return false;
    if (typeof data.epistemics.valid !== 'boolean') return false;
    if (!Array.isArray(data.epistemics.validation_errors)) return false;
    if (data.epistemics.valid !== (data.epistemics.validation_errors.length === 0)) return false;
    if (!isPlainObject(data.epistemics.rollup)) return false;
    if (!isPlainObject(data.epistemics.rollup.counts)) return false;
  }
  if (data.corrections !== undefined) {
    if (!isPlainObject(data.corrections)) return false;
    const { superseded, correction } = data.corrections;
    if (!isPlainObject(superseded) || !isPlainObject(correction)) return false;
    // A correction must reference the exact claim it supersedes, and the
    // superseded claim must be flagged as such - never a silent drop.
    if (superseded.superseded !== true) return false;
    if (correction.corrects_claim_id !== superseded.claim_id) return false;
  }
  try {
    assertResponseGuardrails(data);
  } catch (error) {
    logger.warn('rev_advisor_guardrail_rejected', { codes: error.guardrailErrors || ['unsafe_advisor_response'] });
    return false;
  }
  // Task 206: priority, challenge-comparison and volume/value decomposition
  // blocks are validated fail-closed. They carry no numeric score, so the
  // checks enforce the documented shape and that every cited evidence id
  // resolves to a current or comparison-window item.
  //
  // Task 210 integration fix (Task 206 regression): the main flow emits these
  // as explicit `null` when they do not apply (only INTENT_FINDINGS fills
  // priority/comparison/change), and the meta/correction flows omit them. In
  // JS `null !== undefined` is true, so `!== undefined` let a `null` block
  // through to the shape validator, which rejected it — dropping every
  // non-findings investigation in production. A nullish `!= null` treats both
  // "absent" and "explicit null" as not-present, so only a real block is
  // shape-validated.
  const allEvidence = {};
  for (const item of [...evidence.items, ...((evidence.comparison_items || []))]) {
    if (item && typeof item.id === 'string' && item.id) allEvidence[item.id] = item;
  }
  if (data.priority != null && !validatePriorityBlock(data.priority, allEvidence, { organizationId, storeIds })) return false;
  if (data.priority_comparison != null && !validatePriorityComparisonBlock(data.priority_comparison)) return false;
  if (data.priority_change != null && !validatePriorityChangeBlock(data.priority_change)) return false;
  if (data.contributor_analysis != null && !validateContributorAnalysis(data.contributor_analysis, allEvidence)) return false;
  // Task 210: the adaptive answer structure and evidence-derived confidence
  // are validated fail-closed: closed vocabularies, every claim confidence
  // independently re-derived from this payload's own evidence, coverage
  // represented separately from confidence, and no fabricated numeric score
  // or percentage anywhere in the confidence contract.
  const adaptationErrors = validateResponseAdaptation(data);
  if (adaptationErrors.length > 0) {
    logger.warn('rev_adaptation_rejected', { codes: adaptationErrors });
    return false;
  }
  return true;
}

// Task 206 priority change note (scenario L): a previously top finding that
// is no longer ranked, with the documented reason for the change.
function validatePriorityChangeBlock(change) {
  if (!isPlainObject(change)) return false;
  if (typeof change.finding_id !== 'string' || !change.finding_id) return false;
  if (change.title !== undefined && change.title !== null && typeof change.title !== 'string') return false;
  if (typeof change.reason !== 'string' || !change.reason) return false;
  if (typeof change.statement !== 'string' || !change.statement.trim()) return false;
  return true;
}

// Task 206 priority block: a documented deterministic ranking, never a
// fabricated impact score.
function validatePriorityBlock(priority, knownIds, { organizationId, storeIds }) {
  if (!isPlainObject(priority)) return false;
  if (priority.method_version !== 'finding-priority-v1') return false;
  if (typeof priority.no_valid_findings !== 'boolean') return false;
  if (priority.no_valid_findings_reason !== null &&
      typeof priority.no_valid_findings_reason !== 'string') return false;
  if (priority.no_valid_findings &&
      priority.no_valid_findings_reason !== null &&
      ![
        'verified_no_open_findings', 'evidence_unavailable',
        'stale_findings_require_reverification', 'only_historical_findings',
        'evidence_unverified', 'no_currently_verified_findings',
      ].includes(priority.no_valid_findings_reason)) return false;
  const ranked = priority.ranked;
  if (ranked !== undefined) {
    if (!Array.isArray(ranked)) return false;
    for (let index = 0; index < ranked.length; index += 1) {
      const entry = ranked[index];
      if (!isPlainObject(entry)) return false;
      if (Number.isInteger(entry.rank) && entry.rank !== index + 1) return false;
      if (entry.severity !== undefined && entry.severity !== null && typeof entry.severity !== 'string') return false;
      if (entry.title !== undefined && entry.title !== null && typeof entry.title !== 'string') return false;
    }
  }
  if (priority.tie !== undefined) {
    if (priority.tie !== null) {
      if (!isPlainObject(priority.tie)) return false;
      if (!Array.isArray(priority.tie.finding_ids)) return false;
      if (typeof priority.tie.statement !== 'string') return false;
    }
  }
  if (priority.excluded !== undefined && !Array.isArray(priority.excluded)) return false;
  if ((priority.excluded || []).some(entry => !isPlainObject(entry) ||
    typeof entry.reason !== 'string')) return false;
  if (typeof priority.computed_at !== 'string') return false;
  return true;
}

// Task 206 challenge comparison ("why is that more important than X?").
function validatePriorityComparisonBlock(comparison) {
  if (!isPlainObject(comparison)) return false;
  if (typeof comparison.matched !== 'boolean') return false;
  if (typeof comparison.statement !== 'string' || !comparison.statement.trim()) return false;
  if (comparison.matched === false) {
    if (typeof comparison.reason !== 'string') return false;
    return true;
  }
  if (!isPlainObject(comparison.referenced)) return false;
  if (typeof comparison.ranking_changed !== 'boolean') return false;
  if (comparison.invalidated_previous_top !== undefined) {
    if (!isPlainObject(comparison.invalidated_previous_top)) return false;
    if (typeof comparison.invalidated_previous_top.statement !== 'string') return false;
  }
  return true;
}

// Task 206 volume/value decomposition of the recorded order-value change.
function validateContributorAnalysis(contributor, knownIds) {
  if (!Array.isArray(contributor)) return false;
  return contributor.every(entry => {
    if (!isPlainObject(entry)) return false;
    if (entry.method_version !== 'value-decomposition-v1') return false;
    if (entry.status !== 'available' && entry.status !== 'unsupported') return false;
    if (entry.status === 'unsupported') {
      return typeof entry.reason === 'string' && entry.reason.length > 0;
    }
    for (const key of ['previous_order_count', 'current_order_count', 'previous_order_value',
      'current_order_value', 'value_change', 'average_order_value_previous',
      'order_count_effect', 'order_value_effect']) {
      if (typeof entry[key] !== 'string') return false;
    }
    if (![
      'volume-driven', 'value-driven', 'mixed-offsetting', 'equally-split', 'no_change',
    ].includes(entry.driver)) return false;
    // Every cited evidence id must resolve to a current or comparison item.
    const ids = Object.values({ ...(entry.current_evidence_ids || {}), ...(entry.previous_evidence_ids || {}) });
    return ids.every(id => id && knownIds[id]);
  });
}

async function investigate({
  organizationId, userId, message, conversationId, correlationId, executionId,
  contextPayload = {},
}) {
  const requestCorrelationId = getCorrelationId(
    correlationId || contextPayload?.correlation_id,
  );
  const requestExecutionId = safeId(
    executionId || contextPayload?.execution_id,
  );
  const validation = validateOrchestrateRequest({
    organizationId, userId, message, triggerType: 'conversation',
    triggerPriority: 'normal', contextPayload,
  });
  if (!validation.valid) {
    return {
      success: false,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        failure: safeFailure('invalid_request', 'request_validation', {
          correlationId: requestCorrelationId, executionId: requestExecutionId,
        }),
        message: validation.message,
      },
    };
  }
  const result = await pythonRequest({
    path: '/rev/investigate',
    body: {
      contract_version: '1.0',
      organization_id: organizationId,
      user_id: userId,
      message,
      conversation_id: conversationId || null,
      context_payload: contextPayload,
    },
    correlationId: requestCorrelationId,
    executionId: requestExecutionId,
    timeout: TIMEOUT_POLICY_MS.overallInvestigation,
  });
  if (!result.success) return result;
  if (!validateInvestigationResponse(result.data, organizationId, authorizedContextStoreIds(contextPayload), requestCorrelationId)) {
    logger.error('rev_investigation_invalid_response', {
      correlationId: requestCorrelationId, executionId: requestExecutionId,
    });
    return {
      success: false,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      error: {
        code: ML_ERRORS.INVALID_RESPONSE,
        failure: safeFailure('schema_validation_failed', 'response_validation', {
          correlationId: requestCorrelationId, executionId: requestExecutionId,
        }),
        message: 'Intelligence service returned an invalid response.',
      },
    };
  }
  result.data.correlation_id = result.data.correlation_id || requestCorrelationId;
  result.data.execution_id = result.data.execution_id || requestExecutionId;
  result.data.execution_metadata = result.data.execution_metadata || {
    correlation_id: requestCorrelationId,
    execution_id: requestExecutionId,
    latency_ms: result.latencyMs,
    outcome: result.data.investigation_outcome?.outcome || 'success',
  };
  return { success: true, data: result.data, latencyMs: result.latencyMs,
    correlationId: requestCorrelationId, executionId: requestExecutionId };
}

/**
 * Stream an investigation from Python to the caller.
 *
 * ``onEvent(name, payload)`` receives plan, step, evidence and final events.
 * The final payload is returned so the controller can persist it. An external
 * ``signal`` (browser disconnect / stop) aborts the upstream request.
 */
async function streamInvestigation({
  organizationId, userId, message, conversationId, correlationId,
  executionId, contextPayload = {}, signal, onEvent,
}) {
  const requestCorrelationId = getCorrelationId(
    correlationId || contextPayload?.correlation_id,
  );
  const requestExecutionId = safeId(
    executionId || contextPayload?.execution_id,
  );
  if (!PYTHON_SERVICE_URL || !ML_INTERNAL_KEY) {
    revMetrics.record('rev_provider_failures_total', 1, { category: 'provider_unavailable' });
    const failure = safeFailure('provider_unavailable', 'node_python_stream', {
      correlationId: requestCorrelationId, executionId: requestExecutionId,
    });
    return {
      success: false,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      error: { code: ML_ERRORS.NOT_CONFIGURED, failure,
        message: 'Rev Intelligence is not configured. Contact support.' },
    };
  }
  const validation = validateOrchestrateRequest({
    organizationId, userId, message, triggerType: 'conversation',
    triggerPriority: 'normal', contextPayload,
  });
  if (!validation.valid) {
    return {
      success: false,
      correlationId: requestCorrelationId,
      executionId: requestExecutionId,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        failure: safeFailure('invalid_request', 'request_validation', {
          correlationId: requestCorrelationId, executionId: requestExecutionId,
        }),
        message: validation.message,
      },
    };
  }
  const startedAt = Date.now();
  const timeoutSignal = AbortSignal.timeout(STREAM_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;

  let response;
  try {
    response = await fetch(`${PYTHON_SERVICE_URL}/rev/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': ML_INTERNAL_KEY,
        'X-Correlation-ID': requestCorrelationId,
        'X-Execution-ID': requestExecutionId,
        'X-Contract-Version': CONTRACT_VERSION,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        contract_version: '1.0',
        organization_id: organizationId,
        user_id: userId,
        message,
        conversation_id: conversationId || null,
        correlation_id: requestCorrelationId,
        execution_id: requestExecutionId,
        context_payload: {
          ...contextPayload,
          correlation_id: requestCorrelationId,
          execution_id: requestExecutionId,
          execution_policy: { overall_timeout_ms: TIMEOUT_POLICY_MS.overallInvestigation - 5000 },
        },
      }),
      signal: combined,
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return {
        success: false,
        error: {
          code: signal && signal.aborted ? 'CANCELLED' : ML_ERRORS.TIMEOUT,
          failure: safeFailure(signal && signal.aborted ? 'cancelled' : 'timeout', 'node_python_stream', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
          message: signal && signal.aborted
            ? 'Generation stopped.'
            : 'Intelligence service timed out.',
        },
      };
    }
    logger.warn('rev_stream_connection_failed', {
      correlationId: requestCorrelationId, errorType: error.name,
    });
    return {
      success: false,
      error: { code: ML_ERRORS.UNAVAILABLE,
        failure: safeFailure('connection_failed', 'node_python_stream', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
        message: 'Intelligence service is unavailable.' },
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { success: false, error: { code: ML_ERRORS.AUTH_FAILED,
      failure: safeFailure('authorization_failed', 'node_python_stream', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
      message: 'Intelligence service authentication failed.' } };
  }
  if (!response.ok || !response.body) {
    return { success: false, error: { code: ML_ERRORS.UNAVAILABLE,
      failure: safeFailure('provider_unavailable', 'node_python_stream', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
      message: 'Intelligence service request failed.' } };
  }

  let finalPayload = null;
  let streamError = null;
  let cancelledUpstream = null;
  const parser = createSseParser((event, payload) => {
    if (event === 'final') {
      finalPayload = payload;
      return;
    }
    if (event === 'error') {
      streamError = payload;
      return;
    }
    if (event === 'evidence') {
      if (!isPlainObject(payload) || payload.schema_version !== EVIDENCE_SCHEMA_VERSION ||
          !Array.isArray(payload.items) ||
          !validateEvidenceCollection(payload.items, { organizationId, storeIds: authorizedContextStoreIds(contextPayload) }).valid) {
        streamError = { code: ML_ERRORS.INVALID_RESPONSE, message: 'Intelligence service returned invalid evidence.' };
        return;
      }
    }
    if (event === 'cancelled') {
      // The Python orchestrator abandoned the turn because the merchant
      // pressed Stop or the browser went away. That is not a failure and there
      // is no final payload coming, so it must not fall through to the
      // invalid-response branch below.
      cancelledUpstream = payload || {};
      return;
    }
    if (typeof onEvent === 'function') {
      const tracedPayload = isPlainObject(payload)
        ? { ...payload, correlation_id: payload.correlation_id || requestCorrelationId,
            execution_id: payload.execution_id || requestExecutionId }
        : { value: payload, correlation_id: requestCorrelationId, execution_id: requestExecutionId };
      onEvent(event, tracedPayload);
    }
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.flush();
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return {
        success: false,
        error: {
          code: signal && signal.aborted ? 'CANCELLED' : ML_ERRORS.TIMEOUT,
          failure: safeFailure(signal && signal.aborted ? 'cancelled' : 'timeout', 'node_python_stream', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
          message: signal && signal.aborted ? 'Generation stopped.' : 'Intelligence service timed out.',
        },
      };
    }
    logger.warn('rev_stream_read_failed', {
      correlationId: requestCorrelationId, errorType: error.name,
    });
    return { success: false, error: { code: ML_ERRORS.UNAVAILABLE,
      failure: safeFailure('connection_failed', 'node_python_stream', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
      message: 'The intelligence stream was interrupted.' } };
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }

  if (cancelledUpstream) {
    logger.info('rev_stream_cancelled_upstream', {
      correlationId: requestCorrelationId,
      reason: cancelledUpstream.reason || 'unspecified',
      completedTools: Array.isArray(cancelledUpstream.completed_tools)
        ? cancelledUpstream.completed_tools.length
        : 0,
    });
    return {
      success: false,
      error: { code: 'CANCELLED',
        failure: safeFailure('cancelled', 'python_execution', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
        message: 'Generation stopped.' },
    };
  }
  if (streamError) {
    const fallbackCategory = streamError.code === ML_ERRORS.TIMEOUT ? 'timeout'
      : streamError.code === 'PROVIDER_FAILURE' ? 'provider_unavailable' : 'internal_error';
    const fallback = safeFailure(fallbackCategory, 'python_execution', {
      correlationId: requestCorrelationId, executionId: requestExecutionId,
    });
    const failure = normalizePythonFailure(
      streamError.failure, fallback, requestCorrelationId, requestExecutionId);
    const retryable = failure.retryable === true;
    return {
      success: false,
      error: {
        code: streamError.code || ML_ERRORS.UNAVAILABLE,
        failure,
        retryable,
        message: retryable
          ? 'Rev could not complete this response because its configured AI providers remained unavailable within the retry budget. Please try again shortly.'
          : 'Rev could not complete this response because its configured AI provider rejected the request. Please contact support.',
      },
    };
  }
  if (!validateInvestigationResponse(finalPayload, organizationId, authorizedContextStoreIds(contextPayload), requestCorrelationId)) {
    const revMetrics = require('./revOperationalMetrics');
    revMetrics.record('rev_validation_failures_total', 1, { stage: 'python_response_contract' });
    return { success: false, error: { code: ML_ERRORS.INVALID_RESPONSE,
      failure: safeFailure('schema_validation_failed', 'response_validation', { correlationId: requestCorrelationId, executionId: requestExecutionId }),
      message: 'Intelligence service returned an invalid response.' } };
  }
  finalPayload.correlation_id = finalPayload.correlation_id || requestCorrelationId;
  finalPayload.execution_id = finalPayload.execution_id || requestExecutionId;
  finalPayload.execution_metadata = finalPayload.execution_metadata || {
    correlation_id: requestCorrelationId,
    execution_id: requestExecutionId,
    latency_ms: Date.now() - startedAt,
    outcome: 'success',
  };
  return { success: true, data: finalPayload };
}

async function getToolCatalog({ correlationId } = {}) {
  const result = await pythonRequest({
    method: 'GET', path: '/rev/tools', correlationId: getCorrelationId(correlationId),
  });
  if (!result.success) return result;
  if (!result.data || !Array.isArray(result.data.tools)) {
    return { success: false, error: { code: ML_ERRORS.INVALID_RESPONSE,
      message: 'Tool catalog unavailable.' } };
  }
  return { success: true, data: result.data };
}

/* -------------------------------------------------------------------------- */
/* EXPORTS                                                                    */
/* -------------------------------------------------------------------------- */

module.exports = {
    orchestrate,
    investigate,
    streamInvestigation,
    getToolCatalog,
    rfmSync,
    computeFeatures,
    predictAbandonment,
    predictSensitivity,
    predictOfferValue,
    predictChurnRisk,
    predictSendTime,
    generateMorningBriefings,
    checkAlerts,
    rebuildBusinessState,
    evaluateRecommendationOutcomes,
    runIntelligenceAutomation,
    checkPythonHealth,
    ML_ERRORS,
    CHURN_FEATURES,
    _validateOrchestrateResponse: validateOrchestrateResponse,
    _validateChurnFeatures: validateChurnFeatures,
    _validateOrchestrateRequest: validateOrchestrateRequest,
    _validateInvestigationResponse: validateInvestigationResponse,
    INVESTIGATION_CONTRACT,
};
