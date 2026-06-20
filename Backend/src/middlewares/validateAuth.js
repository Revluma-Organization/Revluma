const Joi = require('joi');

const validateRegister = (req, res, next) => {
    const schema = Joi.object({
        fullName: Joi.string().min(3).max(50).required().messages({
            'string.empty': 'Full name is required',
            'string.min': 'Full name must be at least 3 characters long'
        }),
        email: Joi.string().email().required().messages({
            'string.email': 'Please provide a valid email address',
            'string.empty': 'Email is required'
        }),
        password: Joi.string().min(8).regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/).required().messages({
            'string.min': 'Password must be at least 8 characters long',
            'object.regex': 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'
        })
    });

    const { error } = schema.validate(req.body, { abortEarly: false });
    
    if (error) {
        const errorMessages = error.details.map(detail => detail.message);
        return res.status(400).json({
            success: false,
            errors: errorMessages
        });
    }

    next();
};

module.exports = { validateRegister };