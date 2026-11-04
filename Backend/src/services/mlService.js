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
const { createSseParser } = require('./revStream');

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
  return (
    correlationId ||
    `ml-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`
  );
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
  timeout = TIMEOUT_MS,
  extraHeaders = {},
}) {
  if (!PYTHON_SERVICE_URL || !ML_INTERNAL_KEY) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.NOT_CONFIGURED,
        message:
          'Rev Intelligence is not configured. Contact support.',
      },
    };
  }

  if (!path) {
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
        message:
          'Python intelligence endpoint is not configured.',
      },
    };
  }

  const requestCorrelationId =
    getCorrelationId(correlationId);

  const startTime = Date.now();

  try {
    const response = await axios({
      method,
      url: `${PYTHON_SERVICE_URL}${path}`,
      data: body,
      timeout,
      maxRedirects: 0,

      validateStatus: (status) => status < 500,

      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Key': ML_INTERNAL_KEY,
        'X-Correlation-ID': requestCorrelationId,
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
        error: {
          code: ML_ERRORS.AUTH_FAILED,
          message:
            'Intelligence service authentication failed.',
        },
      };
    }

    if (response.status >= 400) {
      return {
        success: false,
        error: {
          code: ML_ERRORS.UNAVAILABLE,
          message:
            'Intelligence service request failed.',
        },
      };
    }

    return {
      success: true,
      data: response.data,
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;

    if (
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT'
    ) {
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
        error: {
          code: ML_ERRORS.TIMEOUT,
          message:
            'Intelligence service timed out.',
        },
        latencyMs,
      };
    }

    logger.warn(
      {
        operation: path,
        latencyMs,
        correlationId: requestCorrelationId,
        errorType: error.code || 'request_error',
      },
      'ML service request failed'
    );

    return {
      success: false,
      error: {
        code: ML_ERRORS.UNAVAILABLE,
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
  triggerType = 'conversation',
  triggerPriority = 'normal',
  contextPayload = {},
  imageBase64,
  imageMediaType,
}) {
  const request = {
    organization_id: organizationId,
    user_id: userId,

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
  triggerType = 'conversation',
  triggerPriority = 'normal',
  contextPayload = {},
  imageBase64,
  imageMediaType,
}) {
  const requestCorrelationId =
    getCorrelationId(correlationId);

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
      error: {
        code: ML_ERRORS.INVALID_REQUEST,
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
      correlationId:
        requestCorrelationId,
      triggerType,
      triggerPriority,
      contextPayload,
      imageBase64,
      imageMediaType,
    });

  const result =
    await pythonRequest({
      path: '/orchestrate',
      body: requestBody,
      correlationId:
        requestCorrelationId,
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
const STREAM_TIMEOUT_MS = parseInt(process.env.ML_STREAM_TIMEOUT_MS || '120000', 10);

function validateInvestigationResponse(data) {
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
  const evidence = data.evidence;
  if (!isPlainObject(evidence) || !Array.isArray(evidence.items)) return false;
  for (const item of evidence.items) {
    if (!isPlainObject(item)) return false;
    if (typeof item.id !== 'string' || !item.id.startsWith('ev-')) return false;
    if (typeof item.metric !== 'string' || !item.metric) return false;
    if (!['available', 'partial', 'unavailable', 'unsupported'].includes(item.status)) return false;
    if (item.unit === 'currency' && item.status === 'available') {
      if (!/^[A-Z]{3}$/.test(String(item.currency || ''))) return false;
      if (item.value === null || item.value === undefined) return false;
    }
  }
  if (data.facts !== undefined && !Array.isArray(data.facts)) return false;
  if (data.hypotheses !== undefined && !Array.isArray(data.hypotheses)) return false;
  if (data.unknowns !== undefined && !Array.isArray(data.unknowns)) return false;
  if (data.recommendations !== undefined) {
    if (!Array.isArray(data.recommendations)) return false;
    if (data.recommendations.some((rec) => rec && rec.executed === true)) return false;
  }
  return true;
}

async function investigate({
  organizationId, userId, message, conversationId, correlationId,
  contextPayload = {},
}) {
  const validation = validateOrchestrateRequest({
    organizationId, userId, message, triggerType: 'conversation',
    triggerPriority: 'normal', contextPayload,
  });
  if (!validation.valid) {
    return { success: false, error: { code: ML_ERRORS.INVALID_REQUEST, message: validation.message } };
  }
  const requestCorrelationId = getCorrelationId(correlationId);
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
  });
  if (!result.success) return result;
  if (!validateInvestigationResponse(result.data)) {
    logger.error('rev_investigation_invalid_response', {
      correlationId: requestCorrelationId,
    });
    return {
      success: false,
      error: {
        code: ML_ERRORS.INVALID_RESPONSE,
        message: 'Intelligence service returned an invalid response.',
      },
    };
  }
  return { success: true, data: result.data, latencyMs: result.latencyMs };
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
  contextPayload = {}, signal, onEvent,
}) {
  if (!PYTHON_SERVICE_URL || !ML_INTERNAL_KEY) {
    return {
      success: false,
      error: { code: ML_ERRORS.NOT_CONFIGURED,
        message: 'Rev Intelligence is not configured. Contact support.' },
    };
  }
  const validation = validateOrchestrateRequest({
    organizationId, userId, message, triggerType: 'conversation',
    triggerPriority: 'normal', contextPayload,
  });
  if (!validation.valid) {
    return { success: false, error: { code: ML_ERRORS.INVALID_REQUEST, message: validation.message } };
  }
  const requestCorrelationId = getCorrelationId(correlationId);
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
        'X-Contract-Version': CONTRACT_VERSION,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        contract_version: '1.0',
        organization_id: organizationId,
        user_id: userId,
        message,
        conversation_id: conversationId || null,
        context_payload: contextPayload,
      }),
      signal: combined,
    });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return {
        success: false,
        error: {
          code: signal && signal.aborted ? 'CANCELLED' : ML_ERRORS.TIMEOUT,
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
      error: { code: ML_ERRORS.UNAVAILABLE, message: 'Intelligence service is unavailable.' },
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { success: false, error: { code: ML_ERRORS.AUTH_FAILED,
      message: 'Intelligence service authentication failed.' } };
  }
  if (!response.ok || !response.body) {
    return { success: false, error: { code: ML_ERRORS.UNAVAILABLE,
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
    if (event === 'cancelled') {
      // The Python orchestrator abandoned the turn because the merchant
      // pressed Stop or the browser went away. That is not a failure and there
      // is no final payload coming, so it must not fall through to the
      // invalid-response branch below.
      cancelledUpstream = payload || {};
      return;
    }
    if (typeof onEvent === 'function') onEvent(event, payload);
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
    if (error.name === 'AbortError') {
      return {
        success: false,
        error: {
          code: signal && signal.aborted ? 'CANCELLED' : ML_ERRORS.TIMEOUT,
          message: signal && signal.aborted ? 'Generation stopped.' : 'Intelligence service timed out.',
        },
      };
    }
    logger.warn('rev_stream_read_failed', {
      correlationId: requestCorrelationId, errorType: error.name,
    });
    return { success: false, error: { code: ML_ERRORS.UNAVAILABLE,
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
      error: { code: 'CANCELLED', message: 'Generation stopped.' },
    };
  }
  if (streamError) {
    return {
      success: false,
      error: {
        code: streamError.code || ML_ERRORS.UNAVAILABLE,
        message: streamError.message || 'Rev could not complete the investigation.',
      },
    };
  }
  if (!validateInvestigationResponse(finalPayload)) {
    return { success: false, error: { code: ML_ERRORS.INVALID_RESPONSE,
      message: 'Intelligence service returned an invalid response.' } };
  }
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
