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

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL;
const ML_INTERNAL_KEY = process.env.ML_INTERNAL_KEY;

const TIMEOUT_MS = parseInt(
  process.env.ML_TIMEOUT_MS || '15000',
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
  if (!organizationId) {
    return {
      valid: false,
      message:
        'organizationId is required.',
    };
  }

  if (!userId) {
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
  if (!isPlainObject(data)) {
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
    !data.conversation_id ||
    !data.message_id
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
      if (!(field in data)) {
        return false;
      }
    }

    if (
      data.actions !== undefined &&
      !Array.isArray(data.actions)
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
/* EXPORTS                                                                    */
/* -------------------------------------------------------------------------- */

module.exports = {
    orchestrate,
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
};
