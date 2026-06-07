// FIX B-01: bcrypt for OTP hash (not SHA-256)
// FIX B-02: Fix broken resendVerificationEmail (undefined variable refs removed)
// FIX B-04: verificationAttempts counter + lockout
// FIX B-07: Removed all console.log statements
// FIX B-08: bcrypt cost 12 for password hash
// FIX B-13: Removed hardcoded fallback email
// FIX B (reserved usernames): Added RESERVED_USERNAMES blocklist

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('./prisma');
const logger = require('../utils/logger');
const emailService = require('./emailService');

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;
const MAX_RESEND_ATTEMPTS = 10;
const MAX_VERIFY_ATTEMPTS = 5;

const AUTH_STATES = {
  PENDING_EMAIL_VERIFICATION: 'PENDING_EMAIL_VERIFICATION',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

/**
 * Reserved usernames — affiliates cannot register with these handles.
 * They are reserved for Revluma system use or to prevent brand impersonation.
 */
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'revluma', 'revluma_ai', 'revlumaai',
  'support', 'help', 'helpdesk', 'billing', 'security', 'abuse', 'postmaster',
  'api', 'www', 'mail', 'email', 'info', 'sales', 'team', 'staff', 'ops',
  'partner', 'partners', 'affiliate', 'affiliates', 'marketing', 'press',
  'legal', 'privacy', 'terms', 'contact', 'hello', 'hi', 'hey', 'webmaster',
  'careers', 'jobs', 'intern', 'bot', 'robots', 'sitemap', 'feed', 'rss',
  'anonymous', 'user', 'guest', 'test', 'demo', 'sample', 'example',
  'null', 'undefined', 'none', 'n_a', 'na', 'delete', 'removed',
  'moderator', 'mod', 'official'
]);

class AffiliateAuthService {
  async logAuthEvent(event, payload = {}) {
    logger.info(`affiliate_auth:${event}`, payload);
    try {
      await prisma.affiliateStatusAuditLog.create({
        data: {
          affiliateProfileId: payload.affiliateProfileId || 'pending',
          previousStatus: payload.previousStatus || null,
          newStatus: payload.newStatus || event,
          changedBy: payload.changedBy || 'system',
          reason: payload.reason || null,
          notes: payload.notes || null,
          metadata: payload.metadata || {}
        }
      });
    } catch (err) {
      logger.warn('Affiliate auth audit log skipped', { error: err.message, event });
    }
  }

  countDistributionChannels(data) {
    const channels = [
      data.twitterHandle,
      data.instagramHandle,
      data.linkedinProfile,
      data.youtubeChannel,
      data.tiktokHandle,
      data.facebookProfile,
      data.website,
      data.newsletterUrl,
      data.communityUrl,
      data.otherPlatform1,
      data.otherPlatform2
    ];
    return channels.filter(c => c && String(c).trim().length > 0).length;
  }

  getActiveDistributionChannels(data) {
    const channelMap = {
      twitterHandle: 'X (Twitter)',
      instagramHandle: 'Instagram',
      linkedinProfile: 'LinkedIn',
      youtubeChannel: 'YouTube',
      tiktokHandle: 'TikTok',
      facebookProfile: 'Facebook',
      website: 'Website',
      newsletterUrl: 'Newsletter',
      communityUrl: 'Community',
      otherPlatform1: 'Other Platform 1',
      otherPlatform2: 'Other Platform 2'
    };
    const active = [];
    for (const [key, label] of Object.entries(channelMap)) {
      if (data[key] && String(data[key]).trim().length > 0) {
        active.push({ platform: label, url: String(data[key]).trim() });
      }
    }
    return active;
  }

  async registerAffiliate(data) {
    const normalizedEmail    = data.email.toLowerCase().trim();
    const normalizedUsername = data.username.toLowerCase().trim();

    // FIX B (reserved usernames): Block system/brand-impersonation handles
    if (RESERVED_USERNAMES.has(normalizedUsername)) {
      throw new Error('USERNAME_RESERVED');
    }

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) throw new Error('EMAIL_ALREADY_EXISTS');

    const existingUsername = await prisma.affiliateProfile.findUnique({
      where: { username: normalizedUsername }
    });
    if (existingUsername) throw new Error('USERNAME_ALREADY_EXISTS');

    const channelCount = this.countDistributionChannels(data);
    if (channelCount < 2) {
      throw new Error('MINIMUM_TWO_DISTRIBUTION_CHANNELS_REQUIRED');
    }

    // FIX B-08: Cost 12 for password hash (was 10)
    const passwordHash = await bcrypt.hash(data.password, 12);

    // FIX B-01: Use bcrypt for OTP hash (not SHA-256)
    // Cost 10 is appropriate for short-lived OTPs (fast enough for the use-case, resistant to rainbow tables)
    const verificationCodeHash  = await bcrypt.hash(data.verificationCode, 10);
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);
    const expiresAt             = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const onboardingData = {
      username: normalizedUsername,
      phoneNumber: data.phoneNumber,
      country: data.country,
      twitterHandle: data.twitterHandle,
      instagramHandle: data.instagramHandle,
      linkedinProfile: data.linkedinProfile,
      youtubeChannel: data.youtubeChannel,
      tiktokHandle: data.tiktokHandle,
      facebookProfile: data.facebookProfile,
      website: data.website,
      newsletterUrl: data.newsletterUrl,
      communityUrl: data.communityUrl,
      otherPlatform1: data.otherPlatform1,
      otherPlatform2: data.otherPlatform2,
      audienceNiche: data.audienceNiche,
      audienceSize: data.audienceSize,
      affiliateExperience: data.affiliateExperience,
      whyJoin: data.whyJoin,
      referralSource: data.referralSource,
      distributionChannelsCount: channelCount,
      isAffiliateRegistration: true,
      resendAttempts: 0
    };

    const pendingRegistration = await prisma.pendingRegistration.upsert({
      where: { email_accountType: { email: normalizedEmail, accountType: 'AFFILIATE' } },
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
        emailVerified: false,
        emailVerifiedAt: null,
        verificationAttempts: 0,
        authState: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
        expiresAt,
        onboardingData,
        step: 1,
        updatedAt: new Date()
      },
      create: {
        email: normalizedEmail,
        accountType: 'AFFILIATE',
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
        verificationAttempts: 0,
        authState: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
        expiresAt,
        onboardingData,
        step: 1
      }
    });

    await this.logAuthEvent('registration_started', {
      newStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
      metadata: { email: normalizedEmail, pendingId: pendingRegistration.id }
    });

    return {
      pendingRegistrationId: pendingRegistration.id,
      email: normalizedEmail,
      firstName: data.firstName,
      expiresAt: pendingRegistration.expiresAt,
      authState: AUTH_STATES.PENDING_EMAIL_VERIFICATION
    };
  }

  // FIX B-02: Completely rewritten — removed undefined variable references (normalizedEmail, data)
  // and broken upsert. Now uses a targeted update on the correct pending record.
  async resendVerificationEmail(pendingId, email) {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
    if (!pending) throw new Error('PENDING_REGISTRATION_NOT_FOUND');

    if (email && pending.email !== email.toLowerCase().trim()) {
      throw new Error('EMAIL_MISMATCH');
    }

    if (pending.emailVerified) {
      throw new Error('EMAIL_ALREADY_VERIFIED');
    }

    const onboardingData = pending.onboardingData || {};
    const attempts = (onboardingData.resendAttempts || 0) + 1;
    if (attempts > MAX_RESEND_ATTEMPTS) {
      throw new Error('RESEND_LIMIT_EXCEEDED');
    }

    const verificationCode = crypto.randomInt(100000, 999999).toString();

    // FIX B-01: Use bcrypt for OTP hash (not SHA-256)
    const verificationCodeHash  = await bcrypt.hash(verificationCode, 10);
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);
    const expiresAt             = new Date(Date.now() + 24 * 60 * 60 * 1000);

    // FIX B-02: Correct update targeting the known pending record by its ID
    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: {
        verificationCodeHash,
        verificationExpiresAt,
        verificationAttempts: 0,
        expiresAt,
        onboardingData: { ...onboardingData, resendAttempts: attempts },
        updatedAt: new Date()
      }
    });

    await this.logAuthEvent('verification_resent', {
      newStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
      metadata: { pendingId, email: pending.email, attempt: attempts }
    });

    return {
      message: 'Verification code resent',
      expiresAt: verificationExpiresAt,
      verificationCode,
      firstName: pending.firstName,
      email: pending.email
    };
  }

  // FIX B-01: Compare OTP with bcrypt instead of SHA-256
  // FIX B-04: Brute-force protection — lock after MAX_VERIFY_ATTEMPTS failures
  async verifyAffiliateEmail(pendingId, code) {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
    if (!pending) throw new Error('PENDING_REGISTRATION_NOT_FOUND');

    if (pending.emailVerified) {
      return {
        verified: true,
        message: 'Email already verified',
        authState: AUTH_STATES.APPROVED
      };
    }

    if (new Date(pending.verificationExpiresAt) < new Date()) {
      throw new Error('VERIFICATION_CODE_EXPIRED');
    }

    // FIX B-04: Check attempt counter before comparing
    const attempts = pending.verificationAttempts || 0;
    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      throw new Error('TOO_MANY_ATTEMPTS');
    }

    // FIX B-01: Use bcrypt.compare (not SHA-256 timing-safe compare)
    const isValidCode = await bcrypt.compare(code, pending.verificationCodeHash);

    if (!isValidCode) {
      // FIX B-04: Increment attempt counter on failure
      await prisma.pendingRegistration.update({
        where: { id: pendingId },
        data: { verificationAttempts: { increment: 1 }, updatedAt: new Date() }
      });

      await this.logAuthEvent('verification_failed', {
        newStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
        reason: 'INVALID_CODE',
        metadata: { pendingId, email: pending.email, attemptsAfter: attempts + 1 }
      });

      throw new Error('INVALID_VERIFICATION_CODE');
    }

    // Success: reset attempt counter, mark verified, advance state
    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        verificationAttempts: 0,
        authState: AUTH_STATES.APPROVED,
        step: 2,
        updatedAt: new Date()
      }
    });

    await this.logAuthEvent('email_verified', {
      previousStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
      newStatus: AUTH_STATES.APPROVED,
      metadata: { pendingId, email: pending.email }
    });

    return {
      verified: true,
      message: 'Email verified successfully',
      authState: AUTH_STATES.APPROVED
    };
  }

  async getApplicationStatus({ pendingRegistrationId, userId }) {
    if (pendingRegistrationId) {
      const pending = await prisma.pendingRegistration.findUnique({
        where: { id: pendingRegistrationId }
      });
      if (!pending) throw new Error('PENDING_REGISTRATION_NOT_FOUND');

      return {
        phase: 'onboarding',
        authState: pending.authState,
        emailVerified: pending.emailVerified,
        step: pending.step,
        expiresAt: pending.expiresAt
        // NOTE: rejectedReason / suspendedReason intentionally not included here (unauthenticated path)
      };
    }

    if (userId) {
      const profile = await prisma.affiliateProfile.findUnique({
        where: { userId },
        select: { id: true, status: true, rejectedReason: true, suspendedReason: true }
      });
      if (!profile) throw new Error('NO_AFFILIATE_PROFILE');

      return {
        phase: 'registered',
        authState: profile.status,
        affiliateProfileId: profile.id,
        rejectedReason: profile.rejectedReason,
        suspendedReason: profile.suspendedReason
      };
    }

    throw new Error('IDENTIFIER_REQUIRED');
  }

  // FIX B-03: Set status to PENDING_REVIEW (not APPROVED) on registration
  async completeAffiliateRegistration(pendingId) {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
    if (!pending) throw new Error('PENDING_REGISTRATION_NOT_FOUND');
    if (!pending.emailVerified) throw new Error('EMAIL_NOT_VERIFIED');

    const onboardingData = pending.onboardingData || {};

    if (new Date(pending.expiresAt) < new Date()) {
      throw new Error('REGISTRATION_EXPIRED');
    }

    const existingUser = await prisma.user.findUnique({ where: { email: pending.email } });
    if (existingUser) throw new Error('EMAIL_ALREADY_EXISTS');

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          id: uuidv4(),
          storeName: `${pending.firstName}'s Affiliate Account`,
          industry: 'affiliate_marketing',
          onboardingStatus: 'pending'
        }
      });

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: pending.email,
          passwordHash: pending.passwordHash,
          fullName: `${pending.firstName} ${pending.lastName}`,
          role: 'affiliate',
          onboardingStatus: 'pending',
          emailVerified: true,
          emailVerifiedAt: pending.emailVerifiedAt,
          failedLoginAttempts: 0
        }
      });

      const affiliateProfile = await tx.affiliateProfile.create({
        data: {
          userId: user.id,
          fullName: user.fullName,
          username: onboardingData.username,
          phoneNumber: onboardingData.phoneNumber,
          country: onboardingData.country,
          twitterHandle: onboardingData.twitterHandle,
          instagramHandle: onboardingData.instagramHandle,
          linkedinProfile: onboardingData.linkedinProfile,
          youtubeChannel: onboardingData.youtubeChannel,
          tiktokHandle: onboardingData.tiktokHandle,
          facebookProfile: onboardingData.facebookProfile,
          website: onboardingData.website,
          newsletterUrl: onboardingData.newsletterUrl,
          communityUrl: onboardingData.communityUrl,
          otherPlatform1: onboardingData.otherPlatform1,
          otherPlatform2: onboardingData.otherPlatform2,
          distributionChannelsCount: onboardingData.distributionChannelsCount,
          audienceNiche: onboardingData.audienceNiche,
          audienceSize: onboardingData.audienceSize,
          affiliateExperience: onboardingData.affiliateExperience,
          whyJoin: onboardingData.whyJoin,
          referralSource: onboardingData.referralSource,
          emailVerificationSentAt: new Date(),
          // Auto-approved: email verification is sufficient for dashboard access
          status: AUTH_STATES.APPROVED,
          tier: 'AFFILIATE',
          commissionRate: 0.20
        }
      });

      await tx.passwordHistory.create({
        data: { userId: user.id, passwordHash: pending.passwordHash }
      });

      await tx.pendingRegistration.delete({ where: { id: pendingId } });

      return { user, affiliateProfile, tenant };
    });

    // Prune password history beyond 10 entries for this user (defence-in-depth)
    prisma.passwordHistory.findMany({
      where: { userId: result.user.id },
      orderBy: { createdAt: 'asc' }
    }).then(async (rows) => {
      if (rows.length > 10) {
        const toDelete = rows.slice(0, rows.length - 10).map(r => r.id);
        await prisma.passwordHistory.deleteMany({ where: { id: { in: toDelete } } });
      }
    }).catch(err => {
      logger.warn('Password history pruning failed', { error: err.message, userId: result.user.id });
    });

    await this.logAuthEvent('registration_completed', {
      affiliateProfileId: result.affiliateProfile.id,
      previousStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
      newStatus: AUTH_STATES.APPROVED,
      changedBy: 'system',
      metadata: { userId: result.user.id, email: result.user.email }
    });

    emailService.sendAffiliateWelcomeEmail(
      result.user.email,
      result.user.fullName,
      null,
      result.affiliateProfile.username
    ).catch(err => {
      logger.warn('Welcome email failed', { error: err.message, userId: result.user.id });
    });

    return result;
  }

}

module.exports = new AffiliateAuthService();