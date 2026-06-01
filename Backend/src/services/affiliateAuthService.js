/**
 * RAPP Affiliate Authentication Service
 * Handles affiliate-specific registration, verification, and access control
 * Production-grade implementation with comprehensive security
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { prisma } = require('./prisma');
const logger = require('../utils/logger');
const emailService = require('./emailService');

const VERIFICATION_CODE_EXPIRY_MINUTES = 15;
const ACCESS_TOKEN_SALT_ROUNDS = 12;

class AffiliateAuthService {
  /**
   * Register new affiliate - Step 1: Create pending registration
   */
  async registerAffiliate(data) {
    const {
      email,
      password,
      firstName,
      lastName,
      username,
      phoneNumber,
      country,
      // Social distribution channels
      twitterHandle,
      instagramHandle,
      linkedinProfile,
      youtubeChannel,
      tiktokHandle,
      facebookProfile,
      website,
      newsletterUrl,
      communityUrl,
      otherPlatform1,
      otherPlatform2,
      // Profile data
      audienceNiche,
      audienceSize,
      affiliateExperience,
      whyJoin,
      referralSource
    } = data;

    const normalizedEmail = email.toLowerCase().trim();

    // Check for existing user
    const existingUser = await prisma.user.findUnique({
      where: { email: normalizedEmail }
    });

    if (existingUser) {
      throw new Error('EMAIL_ALREADY_EXISTS');
    }

    // Check for existing affiliate with same username
    const existingUsername = await prisma.affiliateProfile.findUnique({
      where: { username: username.toLowerCase().trim() }
    });

    if (existingUsername) {
      throw new Error('USERNAME_ALREADY_EXISTS');
    }

    // Validate minimum 2 distribution channels
    const distributionChannels = [
      twitterHandle,
      instagramHandle,
      linkedinProfile,
      youtubeChannel,
      tiktokHandle,
      facebookProfile,
      website,
      newsletterUrl,
      communityUrl,
      otherPlatform1,
      otherPlatform2
    ].filter(channel => channel && channel.trim().length > 0);

    if (distributionChannels.length < 2) {
      throw new Error('MINIMUM_TWO_DISTRIBUTION_CHANNELS_REQUIRED');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate verification code
    const verificationCode = crypto.randomInt(100000, 999999).toString();
    const verificationCodeHash = await bcrypt.hash(verificationCode, 12);
    const verificationExpiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Store affiliate data in pending registration
    const onboardingData = {
      username: username.toLowerCase().trim(),
      phoneNumber,
      country,
      twitterHandle,
      instagramHandle,
      linkedinProfile,
      youtubeChannel,
      tiktokHandle,
      facebookProfile,
      website,
      newsletterUrl,
      communityUrl,
      otherPlatform1,
      otherPlatform2,
      audienceNiche,
      audienceSize,
      affiliateExperience,
      whyJoin,
      referralSource,
      distributionChannelsCount: distributionChannels.length,
      isAffiliateRegistration: true
    };

    const pendingRegistration = await prisma.pendingRegistration.upsert({
      where: { email: normalizedEmail },
      update: {
        firstName,
        lastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
        emailVerified: false,
        emailVerifiedAt: null,
        expiresAt,
        onboardingData,
        step: 1,
        updatedAt: new Date()
      },
      create: {
        email: normalizedEmail,
        firstName,
        lastName,
        passwordHash,
        verificationCodeHash,
        verificationExpiresAt,
        expiresAt,
        onboardingData,
        step: 1
      }
    });

    // Send verification email
    try {
      await emailService.sendVerificationEmail(normalizedEmail, verificationCode, firstName);
      logger.info('Affiliate registration verification email sent', {
        email: normalizedEmail,
        pendingId: pendingRegistration.id
      });
    } catch (emailError) {
      logger.error('Failed to send affiliate verification email', {
        error: emailError.message,
        email: normalizedEmail
      });
      throw new Error('EMAIL_SEND_FAILED');
    }

    return {
      pendingRegistrationId: pendingRegistration.id,
      email: normalizedEmail,
      expiresAt: pendingRegistration.expiresAt
    };
  }

  /**
   * Verify email code for affiliate registration
   */
  async verifyAffiliateEmail(pendingId, code) {
    const pending = await prisma.pendingRegistration.findUnique({
      where: { id: pendingId }
    });

    if (!pending) {
      throw new Error('PENDING_REGISTRATION_NOT_FOUND');
    }

    if (pending.emailVerified) {
      return { verified: true, message: 'Email already verified' };
    }

    if (new Date(pending.verificationExpiresAt) < new Date()) {
      throw new Error('VERIFICATION_CODE_EXPIRED');
    }

    const isValidCode = await bcrypt.compare(code, pending.verificationCodeHash);
    if (!isValidCode) {
      throw new Error('INVALID_VERIFICATION_CODE');
    }

    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: {
        emailVerified: true,
        emailVerifiedAt: new Date(),
        step: 2,
        updatedAt: new Date()
      }
    });

    logger.info('Affiliate email verified', {
      pendingId,
      email: pending.email
    });

    return { verified: true, message: 'Email verified successfully' };
  }

  /**
   * Validate and consume RAPP access token
   */
  async validateAccessToken(pendingId, tokenString) {
    const pending = await prisma.pendingRegistration.findUnique({
      where: { id: pendingId }
    });

    if (!pending) {
      throw new Error('PENDING_REGISTRATION_NOT_FOUND');
    }

    if (!pending.emailVerified) {
      throw new Error('EMAIL_NOT_VERIFIED');
    }

    // Hash the provided token to look it up
    const tokenHash = crypto.createHash('sha256').update(tokenString).digest('hex');

    const accessToken = await prisma.rappAccessToken.findUnique({
      where: { tokenHash }
    });

    if (!accessToken) {
      // Log failed attempt
      await this.logTokenUsage(null, pending.email, null, null, false, 'TOKEN_NOT_FOUND');
      throw new Error('INVALID_ACCESS_TOKEN');
    }

    // Validate token
    if (!accessToken.isActive) {
      await this.logTokenUsage(accessToken.id, pending.email, null, null, false, 'TOKEN_INACTIVE');
      throw new Error('TOKEN_INACTIVE');
    }

    if (accessToken.expiresAt && new Date(accessToken.expiresAt) < new Date()) {
      await this.logTokenUsage(accessToken.id, pending.email, null, null, false, 'TOKEN_EXPIRED');
      throw new Error('TOKEN_EXPIRED');
    }

    if (accessToken.usedCount >= accessToken.maxUses) {
      await this.logTokenUsage(accessToken.id, pending.email, null, null, false, 'TOKEN_MAX_USES_EXCEEDED');
      throw new Error('TOKEN_MAX_USES_EXCEEDED');
    }

    // Token is valid - increment usage count
    await prisma.rappAccessToken.update({
      where: { id: accessToken.id },
      data: {
        usedCount: { increment: 1 },
        updatedAt: new Date()
      }
    });

    // Update pending registration with token info
    await prisma.pendingRegistration.update({
      where: { id: pendingId },
      data: {
        step: 3,
        onboardingData: {
          ...pending.onboardingData,
          accessTokenId: accessToken.id,
          accessTokenValidatedAt: new Date().toISOString()
        },
        updatedAt: new Date()
      }
    });

    await this.logTokenUsage(accessToken.id, pending.email, null, null, true, null);

    logger.info('RAPP access token validated successfully', {
      tokenId: accessToken.id,
      email: pending.email,
      pendingId
    });

    return {
      valid: true,
      tokenId: accessToken.id,
      message: 'Access token validated successfully'
    };
  }

  /**
   * Complete affiliate registration - Create User + AffiliateProfile
   */
  async completeAffiliateRegistration(pendingId) {
    const pending = await prisma.pendingRegistration.findUnique({
      where: { id: pendingId }
    });

    if (!pending) {
      throw new Error('PENDING_REGISTRATION_NOT_FOUND');
    }

    if (!pending.emailVerified) {
      throw new Error('EMAIL_NOT_VERIFIED');
    }

    if (!pending.onboardingData.accessTokenId) {
      throw new Error('ACCESS_TOKEN_NOT_VALIDATED');
    }

    if (new Date(pending.expiresAt) < new Date()) {
      throw new Error('REGISTRATION_EXPIRED');
    }

    // Check for existing user (race condition protection)
    const existingUser = await prisma.user.findUnique({
      where: { email: pending.email }
    });

    if (existingUser) {
      throw new Error('EMAIL_ALREADY_EXISTS');
    }

    const onboardingData = pending.onboardingData;

    // Create User + AffiliateProfile in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create tenant for affiliate
      const tenant = await tx.tenant.create({
        data: {
          id: uuidv4(),
          storeName: `${pending.firstName}'s Affiliate Account`,
          industry: 'affiliate_marketing',
          onboardingStatus: 'pending'
        }
      });

      // Create user
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

      // Create affiliate profile
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
          accessTokenId: onboardingData.accessTokenId,
          accessTokenUsedAt: new Date(),
          emailVerificationSentAt: new Date(),
          status: 'PENDING', // Awaiting manual review
          tier: 'AFFILIATE',
          commissionRate: 0.20
        }
      });

      // Log token usage with affiliate profile ID
      await this.logTokenUsage(
        onboardingData.accessTokenId,
        pending.email,
        user.id,
        affiliateProfile.id,
        true,
        null
      );

      // Create password history
      await tx.passwordHistory.create({
        data: {
          userId: user.id,
          passwordHash: pending.passwordHash
        }
      });

      // Delete pending registration
      await tx.pendingRegistration.delete({
        where: { id: pendingId }
      });

      return { user, affiliateProfile, tenant };
    });

    logger.info('Affiliate registration completed', {
      userId: result.user.id,
      affiliateProfileId: result.affiliateProfile.id,
      email: result.user.email,
      username: result.affiliateProfile.username
    });

    // Send vetting notification to operations team (non-blocking)
    this.sendVettingNotification(result.affiliateProfile).catch(err => {
      logger.error('Failed to send vetting notification', {
        error: err.message,
        affiliateProfileId: result.affiliateProfile.id
      });
    });

    return result;
  }

  /**
   * Send vetting notification to operations team
   */
  async sendVettingNotification(affiliateProfile) {
    const vettingEmail = process.env.RAPP_VETTING_EMAIL;

    if (!vettingEmail) {
      logger.warn('RAPP_VETTING_EMAIL not configured - skipping vetting notification');
      return;
    }

    // Create notification record
    const notification = await prisma.affiliateVettingNotification.create({
      data: {
        affiliateProfileId: affiliateProfile.id,
        email: vettingEmail,
        status: 'PENDING'
      }
    });

    try {
      await emailService.sendAffiliateVettingNotification(vettingEmail, affiliateProfile);

      await prisma.affiliateVettingNotification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          sentAt: new Date()
        }
      });

      await prisma.affiliateProfile.update({
        where: { id: affiliateProfile.id },
        data: {
          vettingNotificationSentAt: new Date()
        }
      });

      logger.info('Vetting notification sent', {
        affiliateProfileId: affiliateProfile.id,
        vettingEmail
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

  /**
   * Log access token usage
   */
  async logTokenUsage(tokenId, email, userId, affiliateProfileId, success, failureReason) {
    if (!tokenId) return; // Can't log without token ID

    try {
      await prisma.rappTokenUsageLog.create({
        data: {
          tokenId,
          email,
          userId,
          affiliateProfileId,
          success,
          failureReason
        }
      });
    } catch (error) {
      logger.error('Failed to log token usage', { error: error.message });
    }
  }

  /**
   * Generate new RAPP access token (admin only)
   */
  async generateAccessToken(description, maxUses = 1, expiresAt = null, createdBy = null) {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const accessToken = await prisma.rappAccessToken.create({
      data: {
        token,
        tokenHash,
        description,
        maxUses,
        expiresAt,
        createdBy,
        isActive: true
      }
    });

    logger.info('RAPP access token generated', {
      tokenId: accessToken.id,
      description,
      maxUses,
      createdBy
    });

    // Return the plain token only once
    return {
      id: accessToken.id,
      token, // Plain token - show only once
      tokenHash,
      description,
      maxUses,
      expiresAt,
      createdAt: accessToken.createdAt
    };
  }

  /**
   * Revoke access token
   */
  async revokeAccessToken(tokenId, revokedBy, reason) {
    const accessToken = await prisma.rappAccessToken.update({
      where: { id: tokenId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedBy,
        revokedReason: reason
      }
    });

    logger.info('RAPP access token revoked', {
      tokenId,
      revokedBy,
      reason
    });

    return accessToken;
  }
}

module.exports = new AffiliateAuthService();
