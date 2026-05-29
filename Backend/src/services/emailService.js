/**
 * Production Email Service
 * Supports: Resend, SendGrid, and SMTP
 */

const { Resend } = require('resend');
const sgMail = require('@sendgrid/mail');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const config = require('../config/environment');

class EmailService {
  constructor() {
    this.provider = config.email.provider;
    this.from = config.email.from;
    this.initializeProvider();
  }

  initializeProvider() {
    switch (this.provider) {
      case 'resend':
        this.resend = new Resend(config.email.resendApiKey);
        logger.info('Email service initialized with Resend');
        break;

      case 'sendgrid':
        sgMail.setApiKey(config.email.sendgridApiKey);
        logger.info('Email service initialized with SendGrid');
        break;

      case 'smtp':
        this.transporter = nodemailer.createTransport({
          host: config.email.smtp.host,
          port: config.email.smtp.port,
          secure: config.email.smtp.secure,
          auth: {
            user: config.email.smtp.user,
            pass: config.email.smtp.pass,
          },
        });
        logger.info('Email service initialized with SMTP');
        break;

      default:
        throw new Error(`Unsupported email provider: ${this.provider}`);
    }
  }

  /**
   * Send email verification code
   */
  async sendVerificationEmail(email, code, fullName) {
    try {
      const subject = 'Verify Your Revluma Email Address';
      const html = this.getVerificationEmailTemplate(fullName, code);

      const result = await this.send({
        to: email,
        subject,
        html,
      });

      logger.info('Verification email sent', { email, provider: this.provider });
      return result;
    } catch (error) {
      logger.error('Failed to send verification email', { email, error: error.message });
      throw error;
    }
  }

  /**
   * Send welcome email to new affiliate
   */
  async sendAffiliateWelcomeEmail(email, fullName, referralLink, username) {
    try {
      const subject = `Welcome to Revluma Affiliate Program, ${fullName}!`;
      const html = this.getAffiliateWelcomeTemplate(fullName, referralLink, username);

      const result = await this.send({
        to: email,
        subject,
        html,
      });

      logger.info('Affiliate welcome email sent', { email });
      return result;
    } catch (error) {
      logger.error('Failed to send affiliate welcome email', { email, error: error.message });
      throw error;
    }
  }

  /**
   * Send referral conversion notification
   */
  async sendConversionNotification(email, fullName, referredUser) {
    try {
      const subject = 'New Referral Conversion - Revluma';
      const html = this.getConversionNotificationTemplate(fullName, referredUser);

      const result = await this.send({
        to: email,
        subject,
        html,
      });

      logger.info('Conversion notification sent', { email });
      return result;
    } catch (error) {
      logger.error('Failed to send conversion notification', { email, error: error.message });
      throw error;
    }
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(email, resetLink, fullName) {
    try {
      const subject = 'Reset Your Revluma Password';
      const html = this.getPasswordResetTemplate(fullName, resetLink);

      const result = await this.send({
        to: email,
        subject,
        html,
      });

      logger.info('Password reset email sent', { email });
      return result;
    } catch (error) {
      logger.error('Failed to send password reset email', { email, error: error.message });
      throw error;
    }
  }

  /**
   * Core send function - routes to appropriate provider
   */
  async send({ to, subject, html }) {
    switch (this.provider) {
      case 'resend':
        return await this.sendViaResend(to, subject, html);

      case 'sendgrid':
        return await this.sendViaSendGrid(to, subject, html);

      case 'smtp':
        return await this.sendViaSMTP(to, subject, html);

      default:
        throw new Error(`Unsupported email provider: ${this.provider}`);
    }
  }

  async sendViaResend(to, subject, html) {
    try {
      const response = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      return response;
    } catch (error) {
      logger.error('Resend API error', { error: error.message });
      throw error;
    }
  }

  async sendViaSendGrid(to, subject, html) {
    try {
      const msg = {
        to,
        from: this.from,
        subject,
        html,
      };

      const response = await sgMail.send(msg);
      return response;
    } catch (error) {
      logger.error('SendGrid API error', { error: error.message });
      throw error;
    }
  }

  async sendViaSMTP(to, subject, html) {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
      });

      return info;
    } catch (error) {
      logger.error('SMTP error', { error: error.message });
      throw error;
    }
  }

  /**
   * EMAIL TEMPLATES
   */

  getVerificationEmailTemplate(fullName, code) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0A0A0A; color: white; padding: 20px; text-align: center; border-radius: 8px; }
          .content { padding: 20px 0; }
          .code-box { background: #f5f5f5; padding: 20px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 2px; border-radius: 8px; margin: 20px 0; }
          .footer { color: #666; font-size: 12px; margin-top: 20px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Revluma Email Verification</h1>
          </div>
          <div class="content">
            <p>Hi ${fullName},</p>
            <p>Your email verification code is:</p>
            <div class="code-box">${code}</div>
            <p>This code will expire in 24 hours.</p>
            <p>If you didn't request this code, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; 2026 Revluma. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getAffiliateWelcomeTemplate(fullName, referralLink, username) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0A0A0A; color: white; padding: 30px; text-align: center; border-radius: 8px; }
          .content { padding: 20px 0; }
          .link-box { background: #f5f5f5; padding: 15px; border-radius: 8px; word-break: break-all; font-family: monospace; margin: 20px 0; }
          .cta-button { display: inline-block; background: #000; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; margin: 20px 0; font-weight: bold; }
          .footer { color: #666; font-size: 12px; margin-top: 20px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Welcome to Revluma Affiliates</h1>
            <p>You're all set, ${fullName}!</p>
          </div>
          <div class="content">
            <p>Your affiliate account is active. Start earning commissions by sharing your referral link:</p>
            <div class="link-box">${referralLink}</div>
            <p>Track your earnings and referrals in your dashboard:</p>
            <a href="${config.getEmailLink('/affiliate/dashboard')}" class="cta-button">Go to Dashboard</a>
            <p><strong>What's next?</strong></p>
            <ul>
              <li>Share your unique link on social media</li>
              <li>Each referral earns you a 20% commission</li>
              <li>Track clicks and conversions in real-time</li>
              <li>Withdraw earnings monthly</li>
            </ul>
          </div>
          <div class="footer">
            <p>&copy; 2026 Revluma. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getConversionNotificationTemplate(fullName, referredUser) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0A0A0A; color: white; padding: 20px; text-align: center; border-radius: 8px; }
          .content { padding: 20px 0; }
          .highlight { background: #f0f0f0; padding: 15px; border-radius: 8px; margin: 20px 0; }
          .footer { color: #666; font-size: 12px; margin-top: 20px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🎉 New Referral Conversion!</h1>
          </div>
          <div class="content">
            <p>Hi ${fullName},</p>
            <p>Great news! One of your referrals has converted to a paying customer:</p>
            <div class="highlight">
              <p><strong>${referredUser.email}</strong></p>
              <p>Status: Active Subscriber</p>
            </div>
            <p>Commission earned and will be processed at the end of the billing cycle.</p>
            <p>Check your dashboard for full details.</p>
          </div>
          <div class="footer">
            <p>&copy; 2026 Revluma. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getPasswordResetTemplate(fullName, resetLink) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #0A0A0A; color: white; padding: 20px; text-align: center; border-radius: 8px; }
          .content { padding: 20px 0; }
          .cta-button { display: inline-block; background: #000; color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; margin: 20px 0; font-weight: bold; }
          .warning { color: #d32f2f; font-size: 12px; margin-top: 10px; }
          .footer { color: #666; font-size: 12px; margin-top: 20px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Reset Your Revluma Password</h1>
          </div>
          <div class="content">
            <p>Hi ${fullName},</p>
            <p>We received a request to reset your password. Click the button below to proceed:</p>
            <a href="${resetLink}" class="cta-button">Reset Password</a>
            <p>This link expires in 1 hour.</p>
            <p class="warning">If you didn't request this, please ignore this email.</p>
          </div>
          <div class="footer">
            <p>&copy; 2026 Revluma. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

// Export singleton
<<<<<<< HEAD
module.exports = new EmailService();
=======
module.exports = new EmailService();
>>>>>>> 771ee70 (007015d - Production implementation: affiliate system, email service, centralized config)
