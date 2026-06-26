const { body, validationResult } = require('express-validator');

// Helper middleware to catch validation errors and format them
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

// REGISTRATION VALIDATION
const validateRegister = [

    body('account.firstName')
        .trim()
        .notEmpty()
        .withMessage('First name is required'),

    body('account.lastName')
        .trim()
        .notEmpty()
        .withMessage('Last name is required'),

    body('account.email')
        .notEmpty()
        .withMessage('Email is required')
        .isEmail()
        .withMessage('Please provide a valid email address')
        .normalizeEmail(),

    body('account.password')
        .notEmpty()
        .withMessage('Password is required')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/)
        .withMessage(
            'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
        ),
    body('account.confirmPassword')
        .notEmpty()
        .withMessage('Confirm password is required')
        .custom((value, { req }) => {
        if (value !== req.body?.account?.password) {
            throw new Error('Passwords do not match');
        }
        return true;
    }),

    body('account.termsAgreed')
        .custom(value => value === true)
        .withMessage('You must accept the terms and conditions'),

    body('storeSetup.brand_name')
        .trim()
        .notEmpty()
        .withMessage('Brand name is required'),

    body('storeSetup.storeUrl')
        .notEmpty()
        .withMessage('Store URL is required')
        .isURL()
        .withMessage('Please provide a valid store URL'),

    body('storeSetup.storeCategory')
        .trim()
        .notEmpty()
        .withMessage('Store category is required'),

    body('storeSetup.country')
        .trim()
        .notEmpty()
        .withMessage('Country is required'),

    validateRequest
];

// LOGIN VALIDATION
const validateLogin = [

    body('account.email')
        .notEmpty()
        .withMessage('Email is required')
        .isEmail()
        .withMessage('Please provide a valid email address')
        .normalizeEmail(),

    body('account.password')
        .notEmpty()
        .withMessage('Password is required'),

    validateRequest
];

module.exports = {
    validateRegister,
    validateLogin
};