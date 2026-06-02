const sgMail = require('@sendgrid/mail');
const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const config = require('../config/environment');

class EmailService {
  constructor() {
    this.provider = config.email.provider || 'sendgrid';
    this.from = config.email.from || 'noreply@revluma.app';
    this.initializeProvider();
  }

  initializeProvider() {
    switch (this.provider) {
      case 'sendgrid':
        if (config.email.sendgridApiKey) {
          sgMail.setApiKey(config.email.sendgridApiKey);
          logger.info('Email service initialized with SendGrid');
        } else {
          logger.warn('SendGrid API key not configured - emails will be logged only');
        }
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
        this.provider = 'sendgrid';
        logger.warn(`Unsupported email provider, falling back to sendgrid`);
        if (config.email.sendgridApiKey) {
          sgMail.setApiKey(config.email.sendgridApiKey);
        }
    }
  }

  async sendVerificationEmail(email, code, fullName) {
    try {
      const subject = 'Verify Your Revluma Email Address';
      const html = this.getVerificationEmailTemplate(fullName, code);

      return await this.send({ to: email, subject, html });
    } catch (error) {
      logger.error('Failed to send verification email', { email, error: error.message });
      throw error;
    }
  }

  async sendAffiliateVettingNotification(vettingEmail, affiliateProfile) {
    try {
      const subject = 'New RAPP Application Submitted';
      const html = this.getVettingNotificationTemplate(affiliateProfile);

      return await this.send({ to: vettingEmail, subject, html });
    } catch (error) {
      logger.error('Failed to send vetting notification', { vettingEmail, error: error.message });
      throw error;
    }
  }

  async sendAffiliateWelcomeEmail(email, fullName, referralLink, username) {
    try {
      const subject = `Welcome to Revluma Affiliate Program, ${fullName}!`;
      const html = this.getAffiliateWelcomeTemplate(fullName, referralLink, username);

      return await this.send({ to: email, subject, html });
    } catch (error) {
      logger.error('Failed to send affiliate welcome email', { email, error: error.message });
      throw error;
    }
  }

  async sendConversionNotification(email, fullName, referredUser) {
    try {
      const subject = 'New Referral Conversion - Revluma';
      const html = this.getConversionNotificationTemplate(fullName, referredUser);

      return await this.send({ to: email, subject, html });
    } catch (error) {
      logger.error('Failed to send conversion notification', { email, error: error.message });
      throw error;
    }
  }

  async sendPasswordResetEmail(email, resetLink, fullName) {
    try {
      const subject = 'Reset Your Revluma Password';
      const html = this.getPasswordResetTemplate(fullName, resetLink);

      return await this.send({ to: email, subject, html });
    } catch (error) {
      logger.error('Failed to send password reset email', { email, error: error.message });
      throw error;
    }
  }

  async send({ to, subject, html }) {
    switch (this.provider) {
      case 'sendgrid':
        return await this.sendViaSendGrid(to, subject, html);
      case 'smtp':
        return await this.sendViaSMTP(to, subject, html);
      default:
        logger.warn('No email provider configured - email not sent', { to, subject });
        return { logged: true };
    }
  }

  async sendViaSendGrid(to, subject, html) {
    try {
      const msg = { to, from: this.from, subject, html };
      const response = await sgMail.send(msg);
      logger.info('SendGrid email sent', { to, subject });
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

  getVerificationEmailTemplate(fullName, code) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #0a0a0a; }
          .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
          .card { background: #111111; border-radius: 12px; overflow: hidden; }
          .header { background: #0A0A0A; color: white; padding: 30px; text-align: center; border-bottom: 1px solid #222; }
          .header h1 { margin: 0; font-size: 24px; color: #fff; }
          .content { padding: 30px; }
          .content p { color: #a0a0a0; font-size: 16px; line-height: 1.6; margin: 0 0 20px; }
          .code-box { background: #1a1a1a; border: 2px solid #333; border-radius: 8px; padding: 24px; text-align: center; margin: 20px 0; }
          .code-box .code { color: #fff; font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace; margin: 0; }
          .footer { color: #666; font-size: 12px; margin-top: 20px; text-align: center; padding: 20px; border-top: 1px solid #222; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <h1>Verify Your Email</h1>
            </div>
            <div class="content">
              <p>Hi ${fullName},</p>
              <p>Thank you for applying to the Revluma Affiliate Partnership Program. Please use the verification code below to verify your email address:</p>
              <div class="code-box">
                <p class="code">${code}</p>
              </div>
              <p>This code will expire in <strong>15 minutes</strong>.</p>
              <p>If you didn't request this code, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>&copy; 2026 Revluma. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }

  getVettingNotificationTemplate(affiliateProfile) {
    const channels = affiliateProfile.activeChannels || [];
    const channelsHtml = channels.map(c =>
      `<div style="margin: 6px 0;"><span style="color: #888; font-weight: 600;">${c.platform}:</span> <span style="color: #ccc;">${c.url}</span></div>`
    ).join('');

    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #0a0a0a; }
          .container { max-width: 700px; margin: 0 auto; padding: 40px 20px; }
          .card { background: #111111; border-radius: 12px; overflow: hidden; }
          .header { background: #0A0A0A; padding: 30px; text-align: center; border-bottom: 1px solid #222; }
          .header h1 { margin: 0 0 8px; font-size: 24px; color: #fff; }
          .header p { margin: 0; color: #888; font-size: 14px; }
          .content { padding: 30px; }
          .section { margin: 24px 0; padding: 20px; background: #1a1a1a; border-radius: 8px; border: 1px solid #222; }
          .section h2 { margin: 0 0 16px; font-size: 16px; color: #a855f7; text-transform: uppercase; letter-spacing: 1px; }
          .row { display: flex; padding: 8px 0; border-bottom: 1px solid #222; }
          .row:last-child { border-bottom: none; }
          .label { flex: 0 0 140px; color: #888; font-size: 13px; font-weight: 600; }
          .value { flex: 1; color: #ddd; font-size: 13px; }
          .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; background: #a855f7/20; color: #a855f7; border: 1px solid #a855f7/30; }
          .footer { padding: 20px 30px; border-top: 1px solid #222; text-align: center; }
          .footer p { margin: 0; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <h1>New RAPP Application Submitted</h1>
              <p>A new affiliate has requested access to the Revluma Affiliate Partnership Program</p>
            </div>
            <div class="content">
              <div class="section">
                <h2>Contact Information</h2>
                <div class="row"><span class="label">Full Name</span><span class="value">${affiliateProfile.fullName || 'N/A'}</span></div>
                <div class="row"><span class="label">Email</span><span class="value">${affiliateProfile.applicantEmail || 'N/A'}</span></div>
                <div class="row"><span class="label">Username</span><span class="value">${affiliateProfile.username || 'N/A'}</span></div>
                <div class="row"><span class="label">Phone</span><span class="value">${affiliateProfile.phoneNumber || 'N/A'}</span></div>
                <div class="row"><span class="label">Country</span><span class="value">${affiliateProfile.country || 'N/A'}</span></div>
              </div>

              <div class="section">
                <h2>Profile Details</h2>
                <div class="row"><span class="label">Experience Level</span><span class="value">${affiliateProfile.affiliateExperience || 'N/A'}</span></div>
                <div class="row"><span class="label">Audience Niche</span><span class="value">${affiliateProfile.audienceNiche || 'N/A'}</span></div>
                <div class="row"><span class="label">Audience Size</span><span class="value">${affiliateProfile.audienceSize || 'N/A'}</span></div>
                <div class="row"><span class="label">Reason for Joining</span><span class="value">${affiliateProfile.whyJoin || 'N/A'}</span></div>
                ${affiliateProfile.referralSource ? `<div class="row"><span class="label">Referral Source</span><span class="value">${affiliateProfile.referralSource}</span></div>` : ''}
              </div>

              <div class="section">
                <h2>Social Channels (${channels.length})</h2>
                ${channelsHtml || '<div style="color: #666; font-style: italic;">No distribution channels</div>'}
              </div>

              <div class="section">
                <h2>System Information</h2>
                <div class="row"><span class="label">User ID</span><span class="value" style="font-family: monospace; font-size: 11px;">${affiliateProfile.userId || 'N/A'}</span></div>
                <div class="row"><span class="label">Profile ID</span><span class="value" style="font-family: monospace; font-size: 11px;">${affiliateProfile.id || 'N/A'}</span></div>
                <div class="row"><span class="label">Registration Time</span><span class="value">${new Date(affiliateProfile.registrationTime || affiliateProfile.createdAt || Date.now()).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'long' })}</span></div>
                <div class="row"><span class="label">Status</span><span class="value"><span class="badge">PENDING_REVIEW</span></span></div>
              </div>

              <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin: 24px 0 0;">
                <strong style="color: #fff;">Action Required:</strong> This user has completed the RAPP onboarding flow and is awaiting manual review by the Revluma Operations Team.
              </p>
              <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6;">
                Please review the application and approve or reject accordingly in the admin dashboard.
              </p>
            </div>
            <div class="footer">
              <p>&copy; 2026 Revluma. All rights reserved.</p>
              <p style="margin-top: 4px;">This is an automated notification from the RAPP vetting system.</p>
            </div>
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #0a0a0a; }
          .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
          .card { background: #111111; border-radius: 12px; overflow: hidden; }
          .header { background: #0A0A0A; padding: 30px; text-align: center; border-bottom: 1px solid #222; }
          .header h1 { margin: 0; font-size: 24px; color: #fff; }
          .header p { margin: 8px 0 0; color: #888; font-size: 14px; }
          .content { padding: 30px; }
          .content p { color: #a0a0a0; font-size: 16px; line-height: 1.6; }
          .footer { padding: 20px 30px; border-top: 1px solid #222; text-align: center; }
          .footer p { margin: 0; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <h1>Welcome to Revluma Affiliates</h1>
              <p>Your application is under review</p>
            </div>
            <div class="content">
              <p>Hi ${fullName},</p>
              <p>Thank you for applying to the Revluma Affiliate Partnership Program. Your application has been received and is now <strong>pending manual review</strong> by our operations team.</p>
              <p>We will review your application carefully. You will receive an email notification once a decision has been made.</p>
              <p>In the meantime, feel free to prepare your social channels and content strategy. Approved affiliates earn a <strong>20% commission</strong> on every referral.</p>
              <p>If you have any questions, please contact us at <a href="mailto:support@revluma.app" style="color: #a855f7;">support@revluma.app</a>.</p>
            </div>
            <div class="footer">
              <p>&copy; 2026 Revluma. All rights reserved.</p>
            </div>
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #0a0a0a; }
          .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
          .card { background: #111111; border-radius: 12px; overflow: hidden; }
          .header { background: #0A0A0A; padding: 30px; text-align: center; border-bottom: 1px solid #222; }
          .header h1 { margin: 0; font-size: 24px; color: #fff; }
          .content { padding: 30px; }
          .content p { color: #a0a0a0; font-size: 16px; line-height: 1.6; margin: 0 0 20px; }
          .highlight { background: #1a1a1a; padding: 15px; border-radius: 8px; margin: 20px 0; border: 1px solid #333; }
          .footer { padding: 20px 30px; border-top: 1px solid #222; text-align: center; }
          .footer p { margin: 0; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <h1>New Referral Conversion!</h1>
            </div>
            <div class="content">
              <p>Hi ${fullName},</p>
              <p>Great news! One of your referrals has converted to a paying customer:</p>
              <div class="highlight">
                <p><strong style="color:#fff;">${referredUser.email}</strong></p>
                <p>Status: Active Subscriber</p>
              </div>
              <p>Commission earned and will be processed at the end of the billing cycle.</p>
              <p>Check your dashboard for full details.</p>
            </div>
            <div class="footer">
              <p>&copy; 2026 Revluma. All rights reserved.</p>
            </div>
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
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background: #0a0a0a; }
          .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
          .card { background: #111111; border-radius: 12px; overflow: hidden; }
          .header { background: #0A0A0A; padding: 30px; text-align: center; border-bottom: 1px solid #222; }
          .header h1 { margin: 0; font-size: 24px; color: #fff; }
          .content { padding: 30px; }
          .content p { color: #a0a0a0; font-size: 16px; line-height: 1.6; }
          .footer { padding: 20px 30px; border-top: 1px solid #222; text-align: center; }
          .footer p { margin: 0; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="card">
            <div class="header">
              <h1>Reset Your Password</h1>
            </div>
            <div class="content">
              <p>Hi ${fullName},</p>
              <p>We received a request to reset your password. Click the link below to proceed:</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="${resetLink}" style="display: inline-block; background: #a855f7; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">Reset Password</a>
              </p>
              <p>This link expires in 1 hour.</p>
              <p style="color: #ef4444; font-size: 13px;">If you didn't request this, please ignore this email.</p>
            </div>
            <div class="footer">
              <p>&copy; 2026 Revluma. All rights reserved.</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

module.exports = new EmailService();
