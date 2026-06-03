const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('./prisma');
const logger = require('../utils/logger');
const emailService = require('./emailService');

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;
const MAX_RESEND_ATTEMPTS = 10;

const AUTH_STATES = {
  PENDING_EMAIL_VERIFICATION: 'PENDING_EMAIL_VERIFICATION',
  PENDING_REVIEW: 'PENDING_REVIEW',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SUSPENDED: 'SUSPENDED'
};

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
    const normalizedEmail = data.email.toLowerCase().trim();

    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) throw new Error('EMAIL_ALREADY_EXISTS');

    const existingUsername = await prisma.affiliateProfile.findUnique({
      where: { username: data.username.toLowerCase().trim() }
    });
    if (existingUsername) throw new Error('USERNAME_ALREADY_EXISTS');

    const channelCount = this.countDistributionChannels(data);
    if (channelCount < 2) {
      throw new Error('MINIMUM_TWO_DISTRIBUTION_CHANNELS_REQUIRED');
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const verificationCodeHash = crypto.createHash('sha256').update(data.verificationCode).digest('hex');
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const onboardingData = {
      username: data.username.toLowerCase().trim(),
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
      where: { email: normalizedEmail },
      update: {
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
        emailVerified: false,
        emailVerifiedAt: null,
        authState: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
        expiresAt,
        onboardingData,
        step: 1,
        updatedAt: new Date()
      },
      create: {
        email: normalizedEmail,
        firstName: data.firstName,
        lastName: data.lastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
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
    const verificationCodeHash = crypto.createHash('sha256').update(verificationCode).digest('hex');
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);

    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: {
        verificationCodeHash,
        verificationExpiresAt,
        onboardingData: { ...onboardingData, resendAttempts: attempts },
        updatedAt: new Date()
      }
    });

    await this.logAuthEvent('verification_resent', {
      newStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
      metadata: { pendingId, email: pending.email, attempt: attempts }
    });

    return { message: 'Verification code resent', expiresAt: verificationExpiresAt, verificationCode, firstName: pending.firstName, email: pending.email };
  }

  async verifyAffiliateEmail(pendingId, code) {
    const pending = await prisma.pendingRegistration.findUnique({ where: { id: pendingId } });
    if (!pending) throw new Error('PENDING_REGISTRATION_NOT_FOUND');

    if (pending.emailVerified) {
      return {
        verified: true,
        message: 'Email already verified',
        authState: AUTH_STATES.PENDING_REVIEW
      };
    }

    if (new Date(pending.verificationExpiresAt) < new Date()) {
      throw new Error('VERIFICATION_CODE_EXPIRED');
    }

    const isValidCode = crypto.createHash('sha256').update(code).digest('hex') === pending.verificationCodeHash;
    if (!isValidCode) {
      await this.logAuthEvent('verification_failed', {
        newStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
        reason: 'INVALID_CODE',
        metadata: { pendingId, email: pending.email }
      });
      throw new Error('INVALID_VERIFICATION_CODE');
    }

    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        authState: AUTH_STATES.PENDING_REVIEW,
        step: 2,
        updatedAt: new Date()
      }
    });

    await this.logAuthEvent('email_verified', {
      previousStatus: AUTH_STATES.PENDING_EMAIL_VERIFICATION,
      newStatus: AUTH_STATES.PENDING_REVIEW,
      metadata: { pendingId, email: pending.email }
    });

    return {
      verified: true,
      message: 'Email verified successfully',
      authState: AUTH_STATES.PENDING_REVIEW
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

    await this.logAuthEvent('registration_completed', {
      affiliateProfileId: result.affiliateProfile.id,
      previousStatus: AUTH_STATES.PENDING_REVIEW,
      newStatus: AUTH_STATES.APPROVED,
      metadata: { userId: result.user.id, email: result.user.email }
    });

    this.sendVettingNotification(result.affiliateProfile, result.user.email).catch(err => {
      logger.error('Failed to send vetting notification', {
        error: err.message,
        affiliateProfileId: result.affiliateProfile.id
      });
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

  async sendVettingNotification(affiliateProfile, applicantEmail) {
    const vettingEmail = process.env.AFFILIATE_VETTING_EMAIL || process.env.RAPP_VETTING_EMAIL || 'revluma.ai@gmail.com';
    if (!vettingEmail) {
      logger.warn('AFFILIATE_VETTING_EMAIL not configured - skipping vetting notification');
      return;
    }

    const notification = await prisma.affiliateVettingNotification.create({
      data: {
        affiliateProfileId: affiliateProfile.id,
        email: vettingEmail,
        status: 'PENDING'
      }
    });

    try {
      const channels = this.getActiveDistributionChannels(affiliateProfile);

      await emailService.sendAffiliateVettingNotification(vettingEmail, {
        ...affiliateProfile,
        applicantEmail,
        activeChannels: channels,
        registrationTime: new Date().toISOString()
      });

      await prisma.affiliateVettingNotification.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: new Date() }
      });

      await prisma.affiliateProfile.update({
        where: { id: affiliateProfile.id },
        data: { vettingNotificationSentAt: new Date() }
      });
    } catch (error) {
      await prisma.affiliateVettingNotification.update({
        where: { id: notification.id },
        data: {
          status: 'FAILED',
          failureReason: error.message,
          retryCount: { increment: 1 }
        }
      });
      throw error;
    }
  }

}

module.exports = new AffiliateAuthService();
