/**
 * Email & SMS messaging utilities
 *
 * FIX (Email XSS): All user-supplied values (userName, code, customerName, etc.)
 * are now passed through escapeHtml() before being interpolated into HTML templates.
 * The prior version interpolated raw user strings directly, creating XSS vectors
 * in HTML email clients.
 *
 * Note: OTP codes (numeric strings from crypto.randomInt) are escaped as
 * defence-in-depth, but are not themselves user-supplied.
 */

const sgMail = require('@sendgrid/mail');
const logger = require('./logger');

// Initialize SendGrid with API key
if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  logger.warn('SENDGRID_API_KEY is not set — emails will not be delivered');
}

// Email sender configuration
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@revluma.app';
const FROM_NAME  = process.env.SENDGRID_FROM_NAME  || 'Revluma';

/**
 * Escape a string for safe insertion into HTML content.
 * Handles: & < > " '
 * @param {*} s
 * @returns {string}
 */
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─────────────────────────────────────────────────────────
// Core send helpers
// ─────────────────────────────────────────────────────────

async function _sendViaSendGrid(to, subject, html, text) {
  if (!process.env.SENDGRID_API_KEY) {
    logger.warn('SendGrid not configured — email not sent', { to, subject });
    return false;
  }
  const msg = {
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    replyTo: FROM_EMAIL,
    subject,
    html,
    ...(text ? { text } : {})
  };
  const [response] = await sgMail.send(msg);
  logger.info('Email sent via SendGrid', {
    to,
    subject,
    statusCode: response?.statusCode,
    messageId: response?.headers?.['x-message-id'] || null
  });
  return response?.statusCode === 202 || response?.statusCode === 200;
}

// ─────────────────────────────────────────────────────────
// Verification email
// ─────────────────────────────────────────────────────────

/**
 * Send email verification OTP code.
 * @param {string} toEmail
 * @param {string} code   - 6-digit OTP (server-generated, but escaped for defence-in-depth)
 * @param {string} userName - User's display name (user-supplied — must be escaped)
 */
async function sendVerificationEmail(toEmail, code, userName) {
  const safeName = escapeHtml(userName || 'there');
  const safeCode = escapeHtml(String(code));

  const subject = 'Verify your email address - Revluma';
  const text    = `Hi ${userName || 'there'},\n\nYour verification code is: ${code}\n\nThis code will expire in 15 minutes.\n\nIf you didn't request this code, please ignore this email.\n\nBest regards,\nRevluma Team`;
  const html    = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email address</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:40px 40px 20px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Revluma</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 40px;">
              <h2 style="margin:0 0 20px;color:#ffffff;font-size:24px;font-weight:600;">Verify your email address</h2>
              <p style="margin:0 0 20px;color:#a0a0a0;font-size:16px;line-height:1.5;">Hi ${safeName},</p>
              <p style="margin:0 0 30px;color:#a0a0a0;font-size:16px;line-height:1.5;">Thank you for creating your Revluma account. Please use the verification code below to verify your email address:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px;">
                <tr>
                  <td style="background-color:#1a1a1a;border:2px solid #333333;border-radius:8px;padding:30px;text-align:center;">
                    <p style="margin:0 0 10px;color:#a0a0a0;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Your verification code</p>
                    <p style="margin:0;color:#ffffff;font-size:36px;font-weight:700;letter-spacing:8px;font-family:'Courier New',monospace;">${safeCode}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px;color:#a0a0a0;font-size:14px;line-height:1.5;">This code will expire in <strong style="color:#ffffff;">15 minutes</strong>.</p>
              <p style="margin:0;color:#666666;font-size:14px;line-height:1.5;">If you didn't request this code, please ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
              <p style="margin:0 0 10px;color:#666666;font-size:12px;text-align:center;">Best regards,</p>
              <p style="margin:0;color:#ffffff;font-size:14px;text-align:center;font-weight:600;">Revluma Team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    return await _sendViaSendGrid(toEmail, subject, html, text);
  } catch (error) {
    logger.error('Failed to send verification email', { error: error.message, toEmail });
    throw new Error('Failed to send verification email');
  }
}

// ─────────────────────────────────────────────────────────
// Welcome email
// ─────────────────────────────────────────────────────────

/**
 * Send welcome email after successful registration.
 * @param {string} toEmail
 * @param {string} userName - User's display name (user-supplied — must be escaped)
 */
async function sendWelcomeEmail(toEmail, userName) {
  let baseUrl;
  try { baseUrl = require('../config/baseUrl').BASE_URL; } catch (e) { baseUrl = 'https://app.revluma.app'; }

  const safeName = escapeHtml(userName || 'there');
  // Base URL is server-configured, not user input, but we still sanitise for defence-in-depth
  const safeOnboardingUrl = baseUrl.replace(/"/g, '%22') + '/auth/onboarding.html';

  const subject = 'Welcome to Revluma! 🎉';
  const text    = `Hi ${userName || 'there'},\n\nWelcome to Revluma! Your account has been successfully created.\n\nGet started: ${baseUrl}/auth/onboarding.html\n\nBest regards,\nRevluma Team`;
  const html    = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Welcome to Revluma</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:40px 40px 20px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Revluma</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 40px;">
              <h2 style="margin:0 0 20px;color:#ffffff;font-size:24px;font-weight:600;">Welcome to Revluma! 🎉</h2>
              <p style="margin:0 0 20px;color:#a0a0a0;font-size:16px;line-height:1.5;">Hi ${safeName},</p>
              <p style="margin:0 0 30px;color:#a0a0a0;font-size:16px;line-height:1.5;">Your account has been successfully created. You're now ready to start recovering abandoned carts and growing your revenue.</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px;">
                <tr>
                  <td align="center">
                    <a href="${safeOnboardingUrl}" style="display:inline-block;background-color:#ffffff;color:#0a0a0a;text-decoration:none;padding:16px 32px;border-radius:8px;font-weight:600;font-size:16px;">Complete Your Setup</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#666666;font-size:14px;line-height:1.5;">If you have any questions, feel free to reach out to our support team.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
              <p style="margin:0 0 10px;color:#666666;font-size:12px;text-align:center;">Best regards,</p>
              <p style="margin:0;color:#ffffff;font-size:14px;text-align:center;font-weight:600;">Revluma Team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    return await _sendViaSendGrid(toEmail, subject, html, text);
  } catch (error) {
    logger.error('Failed to send welcome email', { error: error.message, toEmail });
    // Non-critical — don't throw
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// Password reset email
// ─────────────────────────────────────────────────────────

/**
 * Send password reset OTP code email.
 * @param {string} toEmail
 * @param {string} code     - 6-digit OTP (server-generated, escaped for defence-in-depth)
 * @param {string} userName - User's display name (user-supplied — must be escaped)
 */
async function sendPasswordResetEmail(toEmail, code, userName) {
  const safeName = escapeHtml(userName || 'there');
  const safeCode = escapeHtml(String(code));

  const subject = `Reset your password - ${FROM_NAME}`;
  const text    = `Hi ${userName || 'there'},\n\nYour password reset code is: ${code}\n\nThis code will expire in 1 hour.\n\nIf you didn't request this, please ignore this email.\n\n${FROM_NAME} Team`;
  const html    = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:40px 40px 20px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">${escapeHtml(FROM_NAME)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 40px;">
              <h2 style="margin:0 0 20px;color:#ffffff;font-size:24px;font-weight:600;">Reset your password</h2>
              <p style="margin:0 0 20px;color:#a0a0a0;font-size:16px;line-height:1.5;">Hi ${safeName},</p>
              <p style="margin:0 0 30px;color:#a0a0a0;font-size:16px;line-height:1.5;">We received a request to reset your password. Use the code below:</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px;">
                <tr>
                  <td style="background-color:#1a1a1a;border:2px solid #333333;border-radius:8px;padding:30px;text-align:center;">
                    <p style="margin:0 0 10px;color:#a0a0a0;font-size:14px;text-transform:uppercase;letter-spacing:1px;">Your reset code</p>
                    <p style="margin:0;color:#ffffff;font-size:36px;font-weight:700;letter-spacing:8px;font-family:'Courier New',monospace;">${safeCode}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 20px;color:#a0a0a0;font-size:14px;line-height:1.5;">This code will expire in <strong style="color:#ffffff;">1 hour</strong>.</p>
              <p style="margin:0;color:#666666;font-size:14px;line-height:1.5;">If you didn't request this, please ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
              <p style="margin:0 0 10px;color:#666666;font-size:12px;text-align:center;">Best regards,</p>
              <p style="margin:0;color:#ffffff;font-size:14px;text-align:center;font-weight:600;">${escapeHtml(FROM_NAME)} Team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    return await _sendViaSendGrid(toEmail, subject, html, text);
  } catch (error) {
    logger.error('Failed to send password reset email', { error: error.message, toEmail });
    throw new Error('Failed to send password reset email');
  }
}

// ─────────────────────────────────────────────────────────
// SMS / WhatsApp (Twilio)
// ─────────────────────────────────────────────────────────

async function sendVerificationSMS(phoneNumber, code) {
  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: `Your Revluma verification code is: ${code}. This code expires in 15 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });
    logger.info('Verification SMS sent', { phoneNumber });
    return true;
  } catch (error) {
    logger.error('Failed to send verification SMS', { error: error.message, phoneNumber });
    throw new Error('Failed to send verification SMS');
  }
}

async function sendVerificationWhatsApp(phoneNumber, code) {
  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: `Your Revluma verification code is: ${code}. This code expires in 15 minutes.`,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${phoneNumber}`
    });
    logger.info('Verification WhatsApp sent', { phoneNumber });
    return true;
  } catch (error) {
    logger.error('Failed to send verification WhatsApp', { error: error.message, phoneNumber });
    throw new Error('Failed to send verification WhatsApp');
  }
}

// ─────────────────────────────────────────────────────────
// Cart recovery emails / WhatsApp
// NOTE: cartData.customerName is user-supplied and must be escaped in HTML.
// cartData.recoveryUrl is server-generated but still sanitised.
// cartData.items[].name may be merchant-supplied product names — escaped.
// ─────────────────────────────────────────────────────────

async function sendRecoveryEmail(toEmail, cartData, touchNumber = 1) {
  const subjectLines = {
    1: 'You left something in your cart!',
    2: 'Still thinking about your order?',
    3: 'Your cart is waiting for you',
    4: "Don't miss out on these items",
    5: 'Last chance to complete your order'
  };

  const safeCustomerName = escapeHtml(cartData.customerName || 'there');
  const safeSubject      = subjectLines[touchNumber] || subjectLines[1];
  const safeCurrency     = escapeHtml(String(cartData.currency || ''));
  const safeCartValue    = escapeHtml(String(cartData.cartValue || ''));
  // Recovery URL is server-generated but sanitised for defence-in-depth
  const safeRecoveryUrl  = (typeof cartData.recoveryUrl === 'string') ? cartData.recoveryUrl.replace(/"/g, '%22') : '#';

  const itemsHtml = (cartData.items || []).map(item => `
    <tr>
      <td style="padding:15px 20px;border-bottom:1px solid #222222;">
        <p style="margin:0;color:#ffffff;font-size:14px;">${escapeHtml(item.name)}</p>
        <p style="margin:5px 0 0;color:#666666;font-size:12px;">Qty: ${escapeHtml(String(item.quantity))}</p>
      </td>
    </tr>`).join('');

  const subject = safeSubject;
  const text    = `Hi ${cartData.customerName || 'there'},\n\nWe noticed you left some items in your cart. Complete your purchase now!\n\nCart Total: ${cartData.currency} ${cartData.cartValue}\n\nComplete your order: ${cartData.recoveryUrl}\n\nBest regards,\nRevluma Team`;
  const html    = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Complete your order</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#111111;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:40px 40px 20px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Revluma</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 40px;">
              <h2 style="margin:0 0 20px;color:#ffffff;font-size:24px;font-weight:600;">${escapeHtml(safeSubject)}</h2>
              <p style="margin:0 0 20px;color:#a0a0a0;font-size:16px;line-height:1.5;">Hi ${safeCustomerName},</p>
              <p style="margin:0 0 30px;color:#a0a0a0;font-size:16px;line-height:1.5;">We noticed you left some items in your cart. Complete your purchase now!</p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px;background-color:#1a1a1a;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:20px;border-bottom:1px solid #333333;">
                    <p style="margin:0;color:#a0a0a0;font-size:14px;">Cart Total</p>
                    <p style="margin:5px 0 0;color:#ffffff;font-size:24px;font-weight:700;">${safeCurrency} ${safeCartValue}</p>
                  </td>
                </tr>
                ${itemsHtml}
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 30px;">
                <tr>
                  <td align="center">
                    <a href="${safeRecoveryUrl}" style="display:inline-block;background-color:#ffffff;color:#0a0a0a;text-decoration:none;padding:16px 32px;border-radius:8px;font-weight:600;font-size:16px;">Complete Your Order</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:#666666;font-size:14px;line-height:1.5;">If you have any questions, feel free to reach out to our support team.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:30px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
              <p style="margin:0 0 10px;color:#666666;font-size:12px;text-align:center;">Best regards,</p>
              <p style="margin:0;color:#ffffff;font-size:14px;text-align:center;font-weight:600;">Revluma Team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    return await _sendViaSendGrid(toEmail, subject, html, text);
  } catch (error) {
    logger.error('Failed to send recovery email', { error: error.message, toEmail, touchNumber });
    throw new Error('Failed to send recovery email');
  }
}

async function sendRecoveryWhatsApp(phoneNumber, cartData, touchNumber = 1) {
  const name      = cartData.customerName || 'there';
  const currency  = cartData.currency || '';
  const cartValue = cartData.cartValue || '';
  const url       = cartData.recoveryUrl || '';
  const messages  = {
    1: `Hi ${name}! 👋 We noticed you left some items in your cart. Total: ${currency} ${cartValue}. Complete your order: ${url}`,
    2: `Still thinking? Your cart is waiting! Total: ${currency} ${cartValue}. Complete now: ${url}`,
    3: `Don't miss out! Items still available. Total: ${currency} ${cartValue}. Shop now: ${url}`,
    4: `Your cart is about to expire! Total: ${currency} ${cartValue}. Shop now: ${url}`,
    5: `Last chance! Total: ${currency} ${cartValue}. Complete before expiry: ${url}`
  };
  try {
    const twilio = require('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: messages[touchNumber] || messages[1],
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${phoneNumber}`
    });
    logger.info('Recovery WhatsApp sent', { phoneNumber, touchNumber });
    return true;
  } catch (error) {
    logger.error('Failed to send recovery WhatsApp', { error: error.message, phoneNumber, touchNumber });
    throw new Error('Failed to send recovery WhatsApp');
  }
}

module.exports = {
  sendVerificationEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendVerificationSMS,
  sendVerificationWhatsApp,
  sendRecoveryEmail,
  sendRecoveryWhatsApp
};