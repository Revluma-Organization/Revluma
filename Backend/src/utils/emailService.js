const sgMail = require('@sendgrid/mail');
const logger = require('./logger');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const emailService = {
  async sendWelcomeEmail(recipientEmail, userData) {
    try {
      const msg = {
        to: recipientEmail,
        from: process.env.SENDGRID_FROM_EMAIL,
        subject: 'Welcome to the Revluma Waitlist! 🎉🚀',
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
                  background-color: #f9f9f9;
                }
                .container {
                  max-width: 600px;
                  margin: 0 auto;
                  background-color: #ffffff;
                  padding: 40px;
                  border-radius: 12px;
                  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                }
                .header {
                  text-align: center;
                  margin-bottom: 30px;
                  border-bottom: 2px solid #f0f0f0;
                  padding-bottom: 20px;
                }
                .logo {
                  font-size: 28px;
                  font-weight: 800;
                  background: linear-gradient(135deg, #ffffff, #d8d8ff 45%, #b5b5ff);
                  -webkit-background-clip: text;
                  -webkit-text-fill-color: transparent;
                  background-clip: text;
                  margin-bottom: 10px;
                }
                .subtitle {
                  font-size: 14px;
                  color: #666;
                  font-weight: 500;
                }
                h1 {
                  font-size: 24px;
                  font-weight: 700;
                  color: #0a0a0a;
                  margin: 20px 0 15px 0;
                }
                .greeting {
                  font-size: 16px;
                  color: #333;
                  margin-bottom: 15px;
                }
                .position-box {
                  background: linear-gradient(135deg, #f5f5ff 0%, #f0f0ff 100%);
                  border-left: 4px solid #7c5cff;
                  padding: 20px;
                  margin: 25px 0;
                  border-radius: 8px;
                }
                .position-label {
                  font-size: 13px;
                  font-weight: 600;
                  color: #666;
                  text-transform: uppercase;
                  letter-spacing: 0.5px;
                  margin-bottom: 8px;
                }
                .position-number {
                  font-size: 48px;
                  font-weight: 800;
                  color: #7c5cff;
                  margin: 0;
                }
                .position-text {
                  font-size: 13px;
                  color: #777;
                  margin-top: 8px;
                }
                .content {
                  font-size: 15px;
                  color: #555;
                  line-height: 1.8;
                  margin: 20px 0;
                }
                .features {
                  background-color: #fafafa;
                  padding: 20px;
                  border-radius: 8px;
                  margin: 25px 0;
                }
                .features-title {
                  font-size: 14px;
                  font-weight: 700;
                  color: #0a0a0a;
                  margin-bottom: 15px;
                }
                .feature-item {
                  font-size: 14px;
                  color: #555;
                  margin: 10px 0;
                  padding-left: 25px;
                  position: relative;
                }
                .feature-item:before {
                  content: "✓";
                  position: absolute;
                  left: 0;
                  color: #7c5cff;
                  font-weight: bold;
                  font-size: 16px;
                }
                .cta-section {
                  text-align: center;
                  margin: 30px 0;
                }
                .cta-button {
                  display: inline-block;
                  background: linear-gradient(135deg, #7c5cff 0%, #6b4df0 100%);
                  color: white;
                  padding: 14px 32px;
                  border-radius: 8px;
                  text-decoration: none;
                  font-weight: 600;
                  font-size: 14px;
                  transition: transform 0.2s;
                }
                .cta-button:hover {
                  transform: translateY(-2px);
                }
                .divider {
                  border: 0;
                  border-top: 1px solid #e0e0e0;
                  margin: 30px 0;
                }
                .footer {
                  text-align: center;
                  padding-top: 20px;
                  border-top: 1px solid #f0f0f0;
                  font-size: 13px;
                  color: #999;
                }
                .footer-text {
                  margin: 8px 0;
                }
                .closing {
                  font-weight: 600;
                  color: #333;
                  margin-top: 15px;
                }
              </style>
            </head>
            <body>
              <div class="container">
                <!-- Header -->
                <div class="header">
                  <div class="logo">Revluma</div>
                  <div class="subtitle">Revenue Recovery & Growth Intelligence</div>
                </div>

                <!-- Main Greeting -->
                <h1>Welcome to the Revluma Waitlist! 🎉🚀</h1>
                <p class="greeting">Hi <strong>${escapeHtml(userData.full_name)}</strong>,</p>

                <!-- Waitlist Position Box -->
                <div class="position-box">
                  <div class="position-label">Your Waitlist Position</div>
                  <div class="position-number">#${userData.waitlist_position}</div>
                  <div class="position-text">You're on the list and we're counting down to early access</div>
                </div>

                <!-- Thank You & Message -->
                <div class="content">
                  <p>Thank you for joining us early and believing in what we're building.</p>
                  <p><strong>Revluma</strong> is designed to help eCommerce brands like yours:</p>
                </div>

                <!-- Features -->
                <div class="features">
                  <div class="features-title">What Revluma Brings to Your Business</div>
                  <div class="feature-item">Recover lost revenue from abandoned carts and churning customers</div>
                  <div class="feature-item">Improve customer retention with AI-powered insights</div>
                  <div class="feature-item">Reduce operational chaos with intelligent automation</div>
                  <div class="feature-item">Make smarter decisions with AI-powered analytics</div>
                </div>

                <!-- Next Steps -->
                <div class="content">
                  <p>We'll keep you updated with our progress and let you know as soon as early access becomes available. Your position will determine priority access to the platform.</p>
                  <p><strong>Stay tuned for:</strong></p>
                  <ul style="color: #555; font-size: 14px; line-height: 1.8;">
                    <li>Exclusive beta features</li>
                    <li>Founding member benefits</li>
                    <li>Special early-bird pricing</li>
                    <li>Direct founder access</li>
                  </ul>
                </div>

                <!-- Closing -->
                <div class="content">
                  <p>We're excited to have you with us.</p>
                  <p class="closing">The Revluma Team</p>
                </div>

                <hr class="divider">

                <!-- Footer -->
                <div class="footer">
                  <div class="footer-text">📧 <strong>Questions?</strong> Reply to this email or visit us at revluma.com</div>
                  <div class="footer-text">🔒 Your data is safe. We never share your information with third parties.</div>
                </div>
              </div>
            </body>
          </html>
        `,
      };

      const result = await sgMail.send(msg);
      logger.info('welcome_email_sent', { to: recipientEmail });
      return true;
    } catch (error) {
      logger.error('welcome_email_failed', { to: recipientEmail, message: error?.message || error });
      throw error;
    }
  },
  
  async sendVerificationEmail(recipientEmail, userName, verificationCode) {
  try {
    const msg = {
      to: recipientEmail,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: "Verify Your Email Address",
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

            h1 {
              color: #111827;
              text-align: center;
            }

            p {
              color: #4b5563;
              font-size: 16px;
              line-height: 1.6;
            }

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

            .footer {
              margin-top: 35px;
              font-size: 13px;
              color: #6b7280;
            }
          </style>
        </head>

        <body>
          <div class="container">

            <h1>Verify Your Email</h1>

            <p>Hello ${userName},</p>

            <p>
              Thank you for signing up for <strong>Revluma</strong>.
              Please use the verification code below to complete your registration.
            </p>

            <div class="code">
              ${verificationCode}
            </div>

            <p>
              This verification code will expire in
              <strong>10 minutes</strong>.
            </p>

            <p>
              If you didn't create this account, you can safely ignore this email.
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

    return {
      success: true,
      message: "Verification email sent successfully.",
    };
  } catch (error) {
    logger.error('verification_email_failed', { to: recipientEmail, message: error?.message || error });
    // Do NOT throw — user was created successfully. Email failure must not block registration.
    // The user can request a resend from the verify-email page.
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
      logger.error('password_reset_email_failed', { message: error?.message || error });
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
      logger.error('password_changed_email_failed', { message: error?.message || error });
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
      logger.error('team_invite_email_failed', { message: error?.message || error });
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
      logger.info('notification_email_sent', { to: recipientEmail });
      return true;
    } catch (error) {
      logger.error('notification_email_failed', { to: recipientEmail, message: error?.message || error });
      throw error;
    }
  },
};


module.exports = emailService;