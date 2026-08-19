/**
 * Revluma Email Service — Resend
 *
 * Switched from SendGrid to Resend.
 * All function signatures and return values are identical — no other files need changing.
 *
 * Required env var:
 *   RESEND_API_KEY — from resend.com dashboard
 *   RESEND_FROM_EMAIL — e.g. "Revluma <revluma.ai@gmail.com>"
 *     Note: to send from a Gmail address on Resend free tier,
 *     use onboarding@resend.dev as the from address during development.
 *     Once you have a domain, change to noreply@revluma.com.
 */

const { Resend } = require('resend');
const logger = require('./logger');

const resend = new Resend(process.env.RESEND_API_KEY);

// From address — falls back to Resend's shared domain for testing
// Replace with your own domain address once revluma.com is verified in Resend
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Revluma <onboarding@resend.dev>';

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const emailService = {

  // ── Welcome / Waitlist ──────────────────────────────────────────────────────
  async sendWelcomeEmail(recipientEmail, userData) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipientEmail,
        subject: 'Welcome to the Revluma Waitlist! 🎉🚀',
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; background-color: #f9f9f9; }
                .container { max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
                .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #f0f0f0; padding-bottom: 20px; }
                .logo { font-size: 28px; font-weight: 800; color: #0a0a0a; margin-bottom: 10px; }
                h1 { font-size: 24px; font-weight: 700; color: #0a0a0a; }
                .position-box { background: #f5f5ff; border-left: 4px solid #7c5cff; padding: 20px; margin: 25px 0; border-radius: 8px; }
                .position-number { font-size: 48px; font-weight: 800; color: #7c5cff; margin: 0; }
                .feature-item { font-size: 14px; color: #555; margin: 10px 0; padding-left: 25px; position: relative; }
                .footer { text-align: center; padding-top: 20px; border-top: 1px solid #f0f0f0; font-size: 13px; color: #999; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <div class="logo">Revluma</div>
                  <div style="font-size:14px;color:#666;">Revenue Recovery & Growth Intelligence</div>
                </div>
                <h1>Welcome to the Revluma Waitlist! 🎉🚀</h1>
                <p>Hi <strong>${escapeHtml(userData.full_name)}</strong>,</p>
                <div class="position-box">
                  <div style="font-size:13px;font-weight:600;color:#666;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">Your Waitlist Position</div>
                  <div class="position-number">#${userData.waitlist_position}</div>
                  <div style="font-size:13px;color:#777;margin-top:8px;">You're on the list and we're counting down to early access</div>
                </div>
                <p>Thank you for joining us early. Revluma is designed to help eCommerce brands like yours recover lost revenue, improve retention, and make smarter decisions with AI.</p>
                <div class="footer">
                  <p>Questions? Reply to this email.</p>
                  <p><strong>The Revluma Team</strong></p>
                </div>
              </div>
            </body>
          </html>
        `,
      });
      logger.info('welcome_email_sent', { to: recipientEmail });
      return true;
    } catch (error) {
      logger.error('welcome_email_failed', { to: recipientEmail, message: error?.message || error });
      throw error;
    }
  },

  // ── Verification OTP ────────────────────────────────────────────────────────
  async sendVerificationEmail(recipientEmail, userName, verificationCode) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipientEmail,
        subject: 'Verify Your Email Address — Revluma',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8" />
            <style>
              body { font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4; margin: 0; padding: 40px 0; }
              .container { max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
              h1 { color: #111827; text-align: center; }
              p { color: #4b5563; font-size: 16px; line-height: 1.6; }
              .code { margin: 30px auto; width: fit-content; background: #EEF2FF; color: #4338CA; font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 18px 32px; border-radius: 8px; }
              .footer { margin-top: 35px; font-size: 13px; color: #6b7280; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Verify Your Email</h1>
              <p>Hello ${escapeHtml(userName)},</p>
              <p>Thank you for signing up for <strong>Revluma</strong>. Please use the verification code below to complete your registration.</p>
              <div class="code">${verificationCode}</div>
              <p>This verification code will expire in <strong>10 minutes</strong>.</p>
              <p>If you didn't create this account, you can safely ignore this email.</p>
              <div class="footer">
                <p>Thanks,</p>
                <p><strong>The Revluma Team</strong></p>
              </div>
            </div>
          </body>
          </html>
        `,
      });
      logger.info('verification_email_sent', { to: recipientEmail });
      return { success: true, message: 'Verification email sent successfully.' };
    } catch (error) {
      logger.error('verification_email_failed', { to: recipientEmail, message: error?.message || error });
      // Do NOT throw — user was created. They can request a resend.
      return { success: false, message: 'Verification email could not be sent.' };
    }
  },

  // ── Password Reset OTP ──────────────────────────────────────────────────────
  async sendPasswordResetEmail(recipientEmail, userName, verificationCode) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipientEmail,
        subject: 'Reset Your Revluma Password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8" />
            <style>
              body { font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4; margin: 0; padding: 40px 0; }
              .container { max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
              h1 { color: #111827; text-align: center; }
              p { color: #4b5563; font-size: 16px; line-height: 1.6; }
              .code { margin: 30px auto; width: fit-content; background: #EEF2FF; color: #4338CA; font-size: 32px; font-weight: bold; letter-spacing: 8px; padding: 18px 32px; border-radius: 8px; }
              .warning { background: #FEF3C7; border: 1px solid #F59E0B; color: #92400E; padding: 12px 16px; border-radius: 6px; font-size: 14px; margin: 20px 0; }
              .footer { margin-top: 35px; font-size: 13px; color: #6b7280; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Reset Your Password</h1>
              <p>Hi ${escapeHtml(userName)},</p>
              <p>We received a request to reset the password for your Revluma account.</p>
              <div class="code">${verificationCode}</div>
              <p>This code will expire in <strong>10 minutes</strong>.</p>
              <div class="warning">If you didn't request this password reset, you can safely ignore this email. Your password will not be changed unless you use this code.</div>
              <div class="footer">
                <p>Thanks,</p>
                <p><strong>The Revluma Team</strong></p>
              </div>
            </div>
          </body>
          </html>
        `,
      });
      logger.info('password_reset_email_sent', { to: recipientEmail });
      return true;
    } catch (error) {
      logger.error('password_reset_email_failed', { message: error?.message || error });
      throw new Error('Failed to send password reset email.');
    }
  },

  // ── Password Changed Notification ───────────────────────────────────────────
  async sendPasswordChangedEmail(recipientEmail, userName) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipientEmail,
        subject: 'Your Revluma Password Was Changed',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8" />
            <style>
              body { font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4; margin: 0; padding: 40px 0; }
              .container { max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
              h1 { color: #111827; text-align: center; }
              p { color: #4b5563; font-size: 16px; line-height: 1.6; }
              .notice { background: #DBEAFE; border: 1px solid #3B82F6; color: #1E40AF; padding: 12px 16px; border-radius: 6px; font-size: 14px; margin: 20px 0; }
              .footer { margin-top: 35px; font-size: 13px; color: #6b7280; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Password Changed</h1>
              <p>Hi ${escapeHtml(userName)},</p>
              <p>Your Revluma account password was just changed.</p>
              <div class="notice">If you did not make this change, contact us immediately at support@revluma.com. All other sessions have been signed out for your security.</div>
              <div class="footer">
                <p>Thanks,</p>
                <p><strong>The Revluma Team</strong></p>
              </div>
            </div>
          </body>
          </html>
        `,
      });
      logger.info('password_changed_email_sent', { to: recipientEmail });
      return true;
    } catch (error) {
      logger.error('password_changed_email_failed', { message: error?.message || error });
      return false; // Non-critical — don't throw
    }
  },

  // ── Team Invite ─────────────────────────────────────────────────────────────
  async sendTeamInviteEmail(recipientEmail, inviterName, companyName, inviteToken) {
    try {
      const inviteUrl = `${process.env.FRONTEND_URL || 'https://revluma.vercel.app'}/invite/accept?token=${inviteToken}`;
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipientEmail,
        subject: `${inviterName} invited you to join ${companyName} on Revluma`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8" />
            <style>
              body { font-family: Arial, Helvetica, sans-serif; background-color: #f4f4f4; margin: 0; padding: 40px 0; }
              .container { max-width: 600px; margin: auto; background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
              h1 { color: #111827; text-align: center; }
              p { color: #4b5563; font-size: 16px; line-height: 1.6; }
              .cta-button { display: inline-block; background: #0a0a0a; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; margin: 20px 0; }
              .footer { margin-top: 35px; font-size: 13px; color: #6b7280; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>You're Invited!</h1>
              <p>Hi,</p>
              <p><strong>${escapeHtml(inviterName)}</strong> has invited you to join <strong>${escapeHtml(companyName)}</strong> on Revluma.</p>
              <p>Click the button below to accept the invite and create your account:</p>
              <a href="${inviteUrl}" class="cta-button">Accept Invite</a>
              <p style="font-size:13px;color:#6b7280;margin-top:20px;">This invite link expires in 7 days. If you didn't expect this email, you can safely ignore it.</p>
              <div class="footer">
                <p>Thanks,</p>
                <p><strong>The Revluma Team</strong></p>
              </div>
            </div>
          </body>
          </html>
        `,
      });
      logger.info('team_invite_email_sent', { to: recipientEmail });
      return true;
    } catch (error) {
      logger.error('team_invite_email_failed', { message: error?.message || error });
      throw new Error('Failed to send team invite email.');
    }
  },

  // ── Waitlist Notification ───────────────────────────────────────────────────
  async sendWaitlistNotification(recipientEmail, subject, message) {
    try {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: recipientEmail,
        subject: subject,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 40px; }
                .logo { font-size: 24px; font-weight: 800; margin-bottom: 30px; }
                .content { font-size: 15px; color: #555; line-height: 1.8; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="logo">Revluma</div>
                <div class="content">${message}</div>
                <br>
                <p>Best regards,<br><strong>The Revluma Team</strong></p>
              </div>
            </body>
          </html>
        `,
      });
      logger.info('notification_email_sent', { to: recipientEmail });
      return true;
    } catch (error) {
      logger.error('notification_email_failed', { to: recipientEmail, message: error?.message || error });
      throw error;
    }
  },
};

module.exports = emailService;