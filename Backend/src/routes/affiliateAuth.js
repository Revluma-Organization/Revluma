/**
 * Affiliate Auth Routes (RAPP)
 * Implements production-grade affiliate onboarding with:
 * - Email verification (SendGrid)
 * - RAPP access token validation (sha256 lookup)
 * - Pending states + manual review submission
 * - Duplicate protection + rate limiting support via server.js
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');
const { requireAffiliateStatus } = require('../middleware/affiliateStatusGuard');
const affiliateAuthService = require('../services/affiliateAuthService');
const emailService = require('../services/emailService');
const { validatePasswordStrength, validateEmail, normalizeEmail } = require('../lib/auth-utils');

const router = express.Router();

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;
const MAX_RESEND_ATTEMPTS = 10;

function getCorrelationId(req) {
    return req.headers['x-correlation-id'] || crypto.randomBytes(4).toString('hex');
}

function sendError(res, statusCode, error, code = null, correlationId = null, detail = null) {
    const body = { error };
    if (code) body.code = code;
    if (correlationId) body.correlationId = correlationId;
    if (detail) body.detail = detail;
    return res.status(statusCode).json(body);
}

function sanitizeString(s, maxLen = 255) {
    if (typeof s !== 'string') return '';
    return s.trim().slice(0, maxLen);
}

/**
 * GET /api/affiliate-auth/check-username/:username
 */
router.get('/check-username/:username', async (req, res) => {
    try {
        const username = sanitizeString(req.params.username, 50).toLowerCase();
        if (!username) return sendError(res, 400, 'Username required', 'VALIDATION_ERROR');

        const existing = await prisma.affiliateProfile.findUnique({ where: { username } });
        return res.json({ available: !existing });
    } catch (err) {
        logger.error('check-username failed', { error: err.message });
        return sendError(res, 500, 'Internal server error', 'SERVER_ERROR');
    }
});

/**
 * POST /api/affiliate-auth/register
 * Creates PendingRegistration, sends verification code.
 */
router.post('/register', async (req, res) => {
    const correlationId = getCorrelationId(req);

    try {
        const body = req.body || {};

        const required = ['email', 'password', 'firstName', 'lastName', 'username', 'phoneNumber', 'country', 'audienceNiche', 'audienceSize', 'affiliateExperience', 'whyJoin'];
        for (const k of required) {
            if (body[k] === undefined || body[k] === null || (typeof body[k] === 'string' && body[k].trim().length === 0)) {
                return sendError(res, 400, `Missing field: ${k}`, 'VALIDATION_ERROR', correlationId);
            }
        }

        if (!validateEmail(body.email)) {
            return sendError(res, 400, 'Please provide a valid email address.', 'INVALID_EMAIL', correlationId);
        }

        const pw = validatePasswordStrength(body.password);
        if (!pw.valid) {
            return sendError(res, 400, pw.error, 'INVALID_PASSWORD', correlationId);
        }

        const registerData = {
            email: normalizeEmail(body.email),
            password: body.password,
            firstName: sanitizeString(body.firstName, 100),
            lastName: sanitizeString(body.lastName, 100),
            username: sanitizeString(body.username, 50),
            phoneNumber: sanitizeString(body.phoneNumber, 30),
            country: sanitizeString(body.country, 2),

            // distribution channels (2+ required by service)
            twitterHandle: sanitizeString(body.twitterHandle, 100) || null,
            instagramHandle: sanitizeString(body.instagramHandle, 100) || null,
            linkedinProfile: sanitizeString(body.linkedinProfile, 200) || null,
            youtubeChannel: sanitizeString(body.youtubeChannel, 200) || null,
            tiktokHandle: sanitizeString(body.tiktokHandle, 100) || null,
            facebookProfile: sanitizeString(body.facebookProfile, 200) || null,
            website: sanitizeString(body.website, 200) || null,
            newsletterUrl: sanitizeString(body.newsletterUrl, 200) || null,
            communityUrl: sanitizeString(body.communityUrl, 200) || null,
            otherPlatform1: sanitizeString(body.otherPlatform1, 200) || null,
            otherPlatform2: sanitizeString(body.otherPlatform2, 200) || null,

            // profile + onboarding
            audienceNiche: sanitizeString(body.audienceNiche, 120),
            audienceSize: sanitizeString(body.audienceSize, 40),
            affiliateExperience: sanitizeString(body.affiliateExperience, 60),
            whyJoin: sanitizeString(body.whyJoin, 2000),
            referralSource: sanitizeString(body.referralSource, 250) || null
        };

        // Delegate validation + code send + min-2 channels requirement
        const result = await affiliateAuthService.registerAffiliate(registerData);
        return res.status(201).json({
            message: 'Verification code sent. Please check your email.',
            pendingRegistrationId: result.pendingRegistrationId,
            email: result.email,
            expiresAt: result.expiresAt
        });
    } catch (err) {
        if (String(err.message).includes('EMAIL_ALREADY_EXISTS')) {
            return sendError(res, 409, 'An account with this email already exists.', 'EMAIL_ALREADY_EXISTS', correlationId);
        }
        if (String(err.message).includes('USERNAME_ALREADY_EXISTS')) {
            return sendError(res, 409, 'That username is already taken.', 'USERNAME_ALREADY_EXISTS', correlationId);
        }
        if (String(err.message).includes('MINIMUM_TWO_DISTRIBUTION_CHANNELS_REQUIRED')) {
            return sendError(res, 400, 'Please provide at least two distribution channels.', 'MINIMUM_TWO_DISTRIBUTION_CHANNELS_REQUIRED', correlationId);
        }

        logger.error('affiliate-auth/register failed', { error: err.message, correlationId });
        return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
    }
});

/**
 * POST /api/affiliate-auth/verify-email
 * Body: { pendingRegistrationId, code }
 */
router.post('/verify-email', async (req, res) => {
    const correlationId = getCorrelationId(req);

    try {
        const { pendingRegistrationId, code } = req.body || {};
        if (!pendingRegistrationId || !code) {
            return sendError(res, 400, 'pendingRegistrationId and code are required', 'VALIDATION_ERROR', correlationId);
        }

        await affiliateAuthService.verifyAffiliateEmail(pendingRegistrationId, sanitizeString(code, 6));

        return res.json({ message: 'Email verified successfully', verified: true });
    } catch (err) {
        const msg = err.message;
        if (msg === 'VERIFICATION_CODE_EXPIRED') {
            return sendError(res, 400, 'Verification code expired', 'VERIFICATION_CODE_EXPIRED', correlationId);
        }
        if (msg === 'INVALID_VERIFICATION_CODE') {
            return sendError(res, 400, 'Invalid verification code', 'INVALID_VERIFICATION_CODE', correlationId);
        }
        if (msg === 'PENDING_REGISTRATION_NOT_FOUND') {
            return sendError(res, 404, 'Pending registration not found', 'PENDING_REGISTRATION_NOT_FOUND', correlationId);
        }

        logger.error('affiliate-auth/verify-email failed', { error: err.message, correlationId });
        return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
    }
});

/**
 * POST /api/affiliate-auth/validate-access-token
 * Body: { pendingRegistrationId, token }
 */
router.post('/validate-access-token', async (req, res) => {
    const correlationId = getCorrelationId(req);

    try {
        const { pendingRegistrationId, token } = req.body || {};

        if (!pendingRegistrationId) {
            return sendError(res, 400, 'pendingRegistrationId is required', 'VALIDATION_ERROR', correlationId);
        }
        if (!token || typeof token !== 'string') {
            return sendError(res, 400, 'Access token is required', 'MISSING_ACCESS_TOKEN', correlationId);
        }

        const result = await affiliateAuthService.validateAccessToken(pendingRegistrationId, sanitizeString(token, 200));

        return res.json({ message: 'Access token validated successfully', valid: true, tokenId: result.tokenId });
    } catch (err) {
        const msg = err.message;

        const map = {
            'EMAIL_NOT_VERIFIED': { status: 403, code: 'EMAIL_NOT_VERIFIED', error: 'Email not verified' },
            'INVALID_ACCESS_TOKEN': { status: 403, code: 'INVALID_ACCESS_TOKEN', error: 'Invalid access token' },
            'TOKEN_INACTIVE': { status: 403, code: 'TOKEN_INACTIVE', error: 'Access token is revoked or inactive' },
            'TOKEN_EXPIRED': { status: 403, code: 'TOKEN_EXPIRED', error: 'Access token expired' },
            'TOKEN_MAX_USES_EXCEEDED': { status: 403, code: 'TOKEN_MAX_USES_EXCEEDED', error: 'Access token usage limit exceeded' },
            'PENDING_REGISTRATION_NOT_FOUND': { status: 404, code: 'PENDING_REGISTRATION_NOT_FOUND', error: 'Pending registration not found' }
        };

        if (map[msg]) {
            return sendError(res, map[msg].status, map[msg].error, map[msg].code, correlationId);
        }

        logger.error('affiliate-auth/validate-access-token failed', { error: err.message, correlationId });
        return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
    }
});

/**
 * POST /api/affiliate-auth/complete-registration
 * Body: { pendingRegistrationId }
 */
router.post('/complete-registration', async (req, res) => {
    const correlationId = getCorrelationId(req);

    try {
        const { pendingRegistrationId } = req.body || {};

        if (!pendingRegistrationId) {
            return sendError(res, 400, 'pendingRegistrationId is required', 'VALIDATION_ERROR', correlationId);
        }

        const result = await affiliateAuthService.completeAffiliateRegistration(pendingRegistrationId);

        // Note: affiliateAuthService already triggers vetting notification (non-blocking)
        return res.status(201).json({
            message: 'Account created successfully. Your application is submitted for review.',
            userId: result.user.id,
            affiliateProfileId: result.affiliateProfile.id,
            status: result.affiliateProfile.status
        });
    } catch (err) {
        const msg = err.message;
        if (msg === 'EMAIL_NOT_VERIFIED') {
            return sendError(res, 403, 'Email must be verified before completing registration', 'EMAIL_NOT_VERIFIED', correlationId);
        }
        if (msg === 'ACCESS_TOKEN_NOT_VALIDATED') {
            return sendError(res, 403, 'A valid RAPP access token must be validated before completing registration', 'ACCESS_TOKEN_NOT_VALIDATED', correlationId);
        }
        if (msg === 'REGISTRATION_EXPIRED') {
            return sendError(res, 410, 'Registration session has expired. Please start over.', 'REGISTRATION_EXPIRED', correlationId);
        }
        if (msg === 'EMAIL_ALREADY_EXISTS') {
            return sendError(res, 409, 'An account with this email already exists.', 'EMAIL_ALREADY_EXISTS', correlationId);
        }

        logger.error('affiliate-auth/complete-registration failed', { error: err.message, correlationId });
        return sendError(res, 500, 'Internal server error', 'SERVER_ERROR', correlationId);
    }
});

module.exports = router;

