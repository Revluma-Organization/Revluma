const { body, param, validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => err.msg);
    return res.status(400).json({
      success: false,
      errors: errorMessages
    });
  }
  next();
};

// Step 1 "secure my spot": only the fields needed to create the waitlist
// row. industry/country/biggest_challenge used to be required here, but
// they're collected later in the optional step-2 form now, so they're
// validated (if present) but no longer mandatory at this stage.
exports.validateWaitlistJoin = [
  body('full_name')
    .trim()
    .notEmpty()
    .withMessage('Full name is required'),
  body('work_email')
    .trim()
    .isEmail()
    .withMessage('Valid email is required')
    .customSanitizer((value) => value.toLowerCase()),
  body('company_name')
    .trim()
    .notEmpty()
    .withMessage('Brand name is required'),
  body('phone_number').trim().optional(),
  body('twitter_handle').trim().optional(),
  body('store_url').trim().optional(),
  body('industry').trim().optional(),
  body('country').trim().optional(),
  body('biggest_challenge').trim().optional(),
  body('hp_field').optional().isBoolean(), // honeypot real users never see/check this
  validateRequest,
];

// Step 2  "tell us more": everything here is optional. This fills in the
// remaining profile fields on a row already created by step 1.
exports.validateWaitlistDetails = [
  param('id').isUUID().withMessage('Invalid waitlist id'),
  body('tiktok_handle').trim().optional(),
  body('instagram_handle').trim().optional(),
  body('website_url').trim().optional(),
  body('industry').trim().optional(),
  body('country').trim().optional(),
  body('state_region').trim().optional(),
  body('team_size').trim().optional(),
  body('monthly_revenue_range').trim().optional(),
  body('monthly_order_volume').trim().optional(),
  body('ecommerce_platform').trim().optional(),
  body('email_platform').trim().optional(),
  body('analytics_platform').trim().optional(),
  body('support_platform').trim().optional(),
  body('ad_platform').trim().optional(),
  body('primary_goal').trim().optional(),
  body('biggest_challenge').trim().optional(),
  body('why_join_waitlist').trim().optional(),
  body('current_churn_problem').optional().isBoolean(),
  body('abandoned_cart_problem').optional().isBoolean(),
  body('retention_problem').optional().isBoolean(),
  body('revenue_visibility_problem').optional().isBoolean(),
  body('interested_in_beta').optional().isBoolean(),
  validateRequest,
];

// Kept for backward compatibility with anything still importing the old name.
exports.validateWaitlist = exports.validateWaitlistJoin;