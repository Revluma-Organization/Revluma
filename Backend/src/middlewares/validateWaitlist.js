const { body, validationResult } = require('express-validator');

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

exports.validateWaitlist = [
  body('full_name')
    .trim()
    .notEmpty()
    .withMessage('Full name is required'),
  body('work_email')
    .trim()
    .isEmail()
    .withMessage('Valid email is required'),
  body('company_name')
    .trim()
    .notEmpty()
    .withMessage('Company name is required'),
  body('industry')
    .trim()
    .notEmpty()
    .withMessage('Industry is required'),
  body('country')
    .trim()
    .notEmpty()
    .withMessage('Country is required'),
  body('biggest_challenge')
    .trim()
    .notEmpty()
    .withMessage('Biggest challenge is required'),
  body('phone_number').trim().optional(),
  body('twitter_handle').trim().optional(),
  body('tiktok_handle').trim().optional(),
  body('instagram_handle').trim().optional(),
  body('website_url').trim().optional(),
  body('store_url').trim().optional(),
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
  body('why_join_waitlist').trim().optional(),
  body('current_churn_problem').optional().isBoolean(),
  body('abandoned_cart_problem').optional().isBoolean(),
  body('retention_problem').optional().isBoolean(),
  body('revenue_visibility_problem').optional().isBoolean(),
  body('interested_in_beta').optional().isBoolean(),
  validateRequest,
];