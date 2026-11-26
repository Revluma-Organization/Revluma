const sgMail = require('@sendgrid/mail');
const logger = require('./logger');

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const emailService = {
  // Confirmation for a submitted Founding Merchants application. It says the
  // application arrived and how we will be in touch. It does not promise
  // acceptance, early access, pricing or features.
  async sendWelcomeEmail(recipientEmail, userData) {
    try {
      const position = Number.isInteger(userData.waitlist_position) && userData.waitlist_position > 0 ? userData.waitlist_position : null;
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'We received your Revluma Founding Merchants application',
        text: [
          `Hi ${userData.full_name},`,
          '',
          'Thanks for applying to the Revluma Founding Merchants program. Your application has been received.',
          'You are now being considered for Founding Merchant access. We read every application and will contact you at this email address about next steps.',
          position ? `Your place in the review queue: #${position}.` : '',
          '',
          'The Revluma Team',
        ].filter((line) => line !== '').join('\n'),
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
            </head>
            <body style="margin:0;padding:32px 12px;background:#fbfaf8;font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0c0a1d;">
              <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e8e6e1;border-radius:20px;padding:36px 32px;">
                <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em;margin-bottom:28px;">Revluma</div>
                <h1 style="margin:0 0 14px;font-size:24px;line-height:1.2;letter-spacing:-0.02em;">Your application has been received</h1>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3f3d4e;">Hi <strong>${escapeHtml(userData.full_name)}</strong>,</p>
                <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3f3d4e;">Thanks for applying to the Revluma Founding Merchants program. You are now being considered for Founding Merchant access.</p>
                <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3f3d4e;">We read every application ourselves and will contact you at this email address about next steps.</p>
                ${position ? `<div style="margin:0 0 22px;padding:14px 16px;border:1px solid #e8e6e1;border-radius:14px;background:#f4f2ee;font-size:14px;color:#3f3d4e;">Your place in the review queue: <strong style="color:#0c0a1d;">#${position}</strong></div>` : ''}
                <p style="margin:0;font-size:15px;line-height:1.6;color:#3f3d4e;">The Revluma Team</p>
                <hr style="border:0;border-top:1px solid #eeece7;margin:28px 0 16px;">
                <p style="margin:0;font-size:12.5px;line-height:1.5;color:#6b6977;">Questions? Reply to this email. We only use your answers to review your application and shape Revluma.</p>
              </div>
            </body>
          </html>
        `,
      };

      await sgMail.send(msg);
      logger.info('welcome_email_sent');
      return true;
    } catch (error) {
      logger.error('welcome_email_failed', {
        error_type: error?.code || error?.name || 'email_provider_error',
      });
      throw error;
    }
  },

  // One-time code to continue a Founding Merchants application on another
  // device. The code is never logged.
  async sendWaitlistResumeCode(recipientEmail, { full_name, code }) {
    const msg = {
      to: recipientEmail,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: `${code} is your code to continue your Revluma application`,
      text: `Hi ${full_name},\n\nUse this code to continue your Revluma Founding Merchants application: ${code}\n\nIt expires in 15 minutes and works once. If you did not ask for it, you can ignore this email.\n\nThe Revluma Team`,
      html: `
        <!DOCTYPE html>
        <html>
          <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
          <body style="margin:0;padding:32px 12px;background:#fbfaf8;font-family:'Instrument Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0c0a1d;">
            <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e8e6e1;border-radius:20px;padding:36px 32px;">
              <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em;margin-bottom:28px;">Revluma</div>
              <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#3f3d4e;">Hi <strong>${escapeHtml(full_name)}</strong>, use this code to continue your Founding Merchants application:</p>
              <div style="margin:22px 0;padding:16px 0;border-radius:14px;background:#eeebff;color:#1f06ac;font-size:30px;font-weight:700;letter-spacing:8px;text-align:center;">${escapeHtml(code)}</div>
              <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#5e5c6b;">It expires in 15 minutes and works once. If you did not ask for it, you can ignore this email.</p>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#3f3d4e;">The Revluma Team</p>
            </div>
          </body>
        </html>
      `,
    };
    await sgMail.send(msg);
    logger.info('waitlist_resume_code_sent');
    return true;
  },

  async sendVerificationEmail(recipientEmail, userName, verificationCode) {
    if (!process.env.SENDGRID_API_KEY || !process.env.SENDGRID_FROM_EMAIL) {
      logger.error('verification_email_not_configured', {
        api_key_configured: Boolean(process.env.SENDGRID_API_KEY),
        from_email_configured: Boolean(process.env.SENDGRID_FROM_EMAIL),
      });
      return { success: false, message: 'Verification email service is not configured.' };
    }

    try {
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Verify Your Email Address',
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
              <div class="footer"><p>Thanks,</p><p><strong>The Revluma Team</strong></p></div>
            </div>
          </body>
          </html>
        `,
      };

      const [providerResponse] = await sgMail.send(msg);
      logger.info('verification_email_accepted_by_provider', {
        provider_status: providerResponse?.statusCode || null,
      });
      return { success: true, message: 'Verification email accepted by provider.' };
    } catch (error) {
      logger.error('verification_email_failed', {
        error_type: error?.code || error?.name || 'email_provider_error',
        provider_status: error?.response?.statusCode || null,
      });
      return { success: false, message: 'Verification email could not be sent.' };
    }
  },


  async sendPasswordResetEmail(recipientEmail, userName, verificationCode) {
    try {
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Reset Your Revluma Password',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8" />
            <style>
              body {
                font-family: Arial, Helvetica, sans-serif;
                background-color: #f4f4f4;
                margin: 0;
                padding: 40px 0;
              }
              .container {
                max-width: 600px;
                margin: auto;
                background: #ffffff;
                border-radius: 8px;
                padding: 40px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
              }
              h1 { color: #111827; text-align: center; }
              p { color: #4b5563; font-size: 16px; line-height: 1.6; }
              .code {
                margin: 30px auto;
                width: fit-content;
                background: #EEF2FF;
                color: #4338CA;
                font-size: 32px;
                font-weight: bold;
                letter-spacing: 8px;
                padding: 18px 32px;
                border-radius: 8px;
              }
              .warning {
                background: #FEF3C7;
                border: 1px solid #F59E0B;
                color: #92400E;
                padding: 12px 16px;
                border-radius: 6px;
                font-size: 14px;
                margin: 20px 0;
              }
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
              <div class="warning">
                If you didn't request this password reset, you can safely ignore this email.
                Your password will not be changed unless you use this code.
              </div>
              <div class="footer">
                <p>Thanks,</p>
                <p><strong>The Revluma Team</strong></p>
              </div>
            </div>
          </body>
          </html>
        `,
      };
      await sgMail.send(msg);
      return true;
    } catch (error) {
      logger.error('password_reset_email_failed', {
        error_type: error?.code || error?.name || 'email_provider_error',
      });
      throw new Error('Failed to send password reset email.');
    }
  },

  async sendPasswordChangedEmail(recipientEmail, userName) {
    try {
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Your Revluma Password Was Changed',
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8" />
            <style>
              body {
                font-family: Arial, Helvetica, sans-serif;
                background-color: #f4f4f4;
                margin: 0;
                padding: 40px 0;
              }
              .container {
                max-width: 600px;
                margin: auto;
                background: #ffffff;
                border-radius: 8px;
                padding: 40px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
              }
              h1 { color: #111827; text-align: center; }
              p { color: #4b5563; font-size: 16px; line-height: 1.6; }
              .notice {
                background: #DBEAFE;
                border: 1px solid #3B82F6;
                color: #1E40AF;
                padding: 12px 16px;
                border-radius: 6px;
                font-size: 14px;
                margin: 20px 0;
              }
              .footer { margin-top: 35px; font-size: 13px; color: #6b7280; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>Password Changed</h1>
              <p>Hi ${escapeHtml(userName)},</p>
              <p>Your Revluma account password was just changed.</p>
              <div class="notice">
                If you did not make this change, contact us immediately at support@revluma.com.
                All other sessions have been signed out for your security.
              </div>
              <div class="footer">
                <p>Thanks,</p>
                <p><strong>The Revluma Team</strong></p>
              </div>
            </div>
          </body>
          </html>
        `,
      };
      await sgMail.send(msg);
      return true;
    } catch (error) {
      logger.error('password_changed_email_failed', {
        error_type: error?.code || error?.name || 'email_provider_error',
      });
      // Non-critical — don't throw, just log
      return false;
    }
  },

  async sendTeamInviteEmail(recipientEmail, inviterName, companyName, inviteToken) {
    try {
      const inviteUrl = `${process.env.FRONTEND_URL || 'https://app.revluma.com'}/invite/accept?token=${inviteToken}`;
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: `${inviterName} invited you to join ${companyName} on Revluma`,
        html: `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8" />
            <style>
              body {
                font-family: Arial, Helvetica, sans-serif;
                background-color: #f4f4f4;
                margin: 0;
                padding: 40px 0;
              }
              .container {
                max-width: 600px;
                margin: auto;
                background: #ffffff;
                border-radius: 8px;
                padding: 40px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
              }
              h1 { color: #111827; text-align: center; }
              p { color: #4b5563; font-size: 16px; line-height: 1.6; }
              .cta-button {
                display: inline-block;
                background: linear-gradient(135deg, #7c5cff 0%, #6b4df0 100%);
                color: white;
                padding: 14px 32px;
                border-radius: 8px;
                text-decoration: none;
                font-weight: 600;
                font-size: 14px;
                margin: 20px 0;
              }
              .footer { margin-top: 35px; font-size: 13px; color: #6b7280; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>You're Invited!</h1>
              <p>Hi,</p>
              <p>
                <strong>${escapeHtml(inviterName)}</strong> has invited you to join
                <strong>${escapeHtml(companyName)}</strong> on Revluma.
              </p>
              <p>Click the button below to accept the invite and create your account:</p>
              <a href="${inviteUrl}" class="cta-button">Accept Invite</a>
              <p style="font-size: 13px; color: #6b7280; margin-top: 20px;">
                This invite link expires in 7 days. If you didn't expect this email, you can safely ignore it.
              </p>
              <div class="footer">
                <p>Thanks,</p>
                <p><strong>The Revluma Team</strong></p>
              </div>
            </div>
          </body>
          </html>
        `,
      };
      await sgMail.send(msg);
      return true;
    } catch (error) {
      logger.error('team_invite_email_failed', {
        error_type: error?.code || error?.name || 'email_provider_error',
      });
      throw new Error('Failed to send team invite email.');
    }
  },

  async sendWaitlistNotification(recipientEmail, subject, message) {
    try {
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: subject,
        html: `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <style>
                body {
                  font-family: 'Satoshi', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                  line-height: 1.6;
                  color: #333;
                }
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  padding: 40px;
                }
                .logo {
                  font-size: 24px;
                  font-weight: 800;
                  margin-bottom: 30px;
                }
                .content {
                  font-size: 15px;
                  color: #555;
                  line-height: 1.8;
                }
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
      };

      await sgMail.send(msg);
      logger.info('notification_email_sent');
      return true;
    } catch (error) {
      logger.error('notification_email_failed', {
        error_type: error?.code || error?.name || 'email_provider_error',
      });
      throw error;
    }
  },
};


module.exports = emailService;
