const sgMail = require('@sendgrid/mail');
const logger = require('./logger');

// Initialize SendGrid with API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Email sender configuration
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@revluma.onrender.com';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Revluma';

/**
 * Send email verification code
 * @param {string} toEmail - Recipient email
 * @param {string} code - 6-digit verification code
 * @param {string} userName - User's full name
 * @returns {Promise<boolean>} - Success status
 */
async function sendVerificationEmail(toEmail, code, userName) {
  try {
    const msg = {
      to: toEmail,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      replyTo: FROM_EMAIL,
      subject: 'Verify your email address - Revluma',
      text: `Hi ${userName},\n\nYour verification code is: ${code}\n\nThis code will expire in 15 minutes.\n\nIf you didn't request this code, please ignore this email.\n\nBest regards,\nRevluma Team`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify your email address</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #111111; border-radius: 12px; overflow: hidden;">
                  <!-- Header -->
                  <tr>
                    <td style="padding: 40px 40px 20px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Revluma</h1>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 20px 40px 40px;">
                      <h2 style="margin: 0 0 20px; color: #ffffff; font-size: 24px; font-weight: 600;">Verify your email address</h2>
                      <p style="margin: 0 0 20px; color: #a0a0a0; font-size: 16px; line-height: 1.5;">Hi ${userName},</p>
                      <p style="margin: 0 0 30px; color: #a0a0a0; font-size: 16px; line-height: 1.5;">Thank you for creating your Revluma account. Please use the verification code below to verify your email address:</p>
                      
                      <!-- Verification Code Box -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px;">
                        <tr>
                          <td style="background-color: #1a1a1a; border: 2px solid #333333; border-radius: 8px; padding: 30px; text-align: center;">
                            <p style="margin: 0 0 10px; color: #a0a0a0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Your verification code</p>
                            <p style="margin: 0; color: #ffffff; font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">${code}</p>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="margin: 0 0 20px; color: #a0a0a0; font-size: 14px; line-height: 1.5;">This code will expire in <strong style="color: #ffffff;">15 minutes</strong>.</p>
                      <p style="margin: 0; color: #666666; font-size: 14px; line-height: 1.5;">If you didn't request this code, please ignore this email.</p>
                    </td>
                  </tr>
                   
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 30px 40px; background-color: #0a0a0a; border-top: 1px solid #222222;">
                      <p style="margin: 0 0 10px; color: #666666; font-size: 12px; text-align: center;">Best regards,</p>
                      <p style="margin: 0; color: #ffffff; font-size: 14px; text-align: center; font-weight: 600;">Revluma Team</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    };

    logger.info('Sending verification email via SendGrid', { toEmail, fromEmail: FROM_EMAIL });
    const [response] = await sgMail.send(msg);
    const messageId = response?.headers?.['x-message-id'] || response?.headers?.['X-Message-Id'] || null;
    logger.info('Verification email queued', {
      toEmail,
      statusCode: response?.statusCode,
      statusMessage: response?.statusMessage,
      messageId
    });

    return response?.statusCode === 202 || response?.statusCode === 200;
  } catch (error) {
    const sendgridDetails = error.response?.body || error.response || null;
    logger.error('Failed to send verification email', {
      error: error.message,
      toEmail,
      code: error.code,
      sendgridDetails
    });
    throw new Error('Failed to send verification email');
  }
}

/**
 * Send welcome email after successful registration
 * @param {string} toEmail - Recipient email
 * @param {string} userName - User's full name
 * @returns {Promise<boolean>} - Success status
 */
async function sendWelcomeEmail(toEmail, userName) {
  try {
    const msg = {
      to: toEmail,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: 'Welcome to Revluma! 🎉',
      text: `Hi ${userName},\n\nWelcome to Revluma! Your account has been successfully created.\n\nYou're now ready to start recovering abandoned carts and growing your revenue.\n\nGet started by completing your onboarding:\n${process.env.FRONTEND_URL || 'https://revluma.onrender.com'}/auth/onboarding.html\n\nBest regards,\nRevluma Team`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Welcome to Revluma</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #111111; border-radius: 12px; overflow: hidden;">
                  <!-- Header -->
                  <tr>
                    <td style="padding: 40px 40px 20px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Revluma</h1>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 20px 40px 40px;">
                      <h2 style="margin: 0 0 20px; color: #ffffff; font-size: 24px; font-weight: 600;">Welcome to Revluma! 🎉</h2>
                      <p style="margin: 0 0 20px; color: #a0a0a0; font-size: 16px; line-height: 1.5;">Hi ${userName},</p>
                      <p style="margin: 0 0 30px; color: #a0a0a0; font-size: 16px; line-height: 1.5;">Your account has been successfully created. You're now ready to start recovering abandoned carts and growing your revenue.</p>
                      
                      <!-- CTA Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px;">
                        <tr>
                          <td align="center">
                            <a href="${process.env.FRONTEND_URL || 'https://revluma.onrender.com'}/auth/onboarding.html" style="display: inline-block; background-color: #ffffff; color: #0a0a0a; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Complete Your Setup</a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="margin: 0; color: #666666; font-size: 14px; line-height: 1.5;">If you have any questions, feel free to reach out to our support team.</p>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 30px 40px; background-color: #0a0a0a; border-top: 1px solid #222222;">
                      <p style="margin: 0 0 10px; color: #666666; font-size: 12px; text-align: center;">Best regards,</p>
                      <p style="margin: 0; color: #ffffff; font-size: 14px; text-align: center; font-weight: 600;">Revluma Team</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    };

    await sgMail.send(msg);
    logger.info('Welcome email sent successfully', { toEmail });
    return true;
  } catch (error) {
    logger.error('Failed to send welcome email', { 
      error: error.message, 
      toEmail 
    });
    // Don't throw error for welcome email - it's not critical
    return false;
  }
}

/**
 * Send SMS verification code via Twilio (SendGrid doesn't support SMS directly)
 * @param {string} phoneNumber - Recipient phone number
 * @param {string} code - 6-digit verification code
 * @returns {Promise<boolean>} - Success status
 */
async function sendVerificationSMS(phoneNumber, code) {
  try {
    // Twilio SMS integration
    const twilio = require('twilio');
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.messages.create({
      body: `Your Revluma verification code is: ${code}. This code expires in 15 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber
    });

    logger.info('Verification SMS sent successfully', { phoneNumber });
    return true;
  } catch (error) {
    logger.error('Failed to send verification SMS', { 
      error: error.message, 
      phoneNumber 
    });
    throw new Error('Failed to send verification SMS');
  }
}

/**
 * Send WhatsApp verification code via Twilio
 * @param {string} phoneNumber - Recipient phone number (with country code)
 * @param {string} code - 6-digit verification code
 * @returns {Promise<boolean>} - Success status
 */
async function sendVerificationWhatsApp(phoneNumber, code) {
  try {
    // Twilio WhatsApp integration
    const twilio = require('twilio');
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.messages.create({
      body: `Your Revluma verification code is: ${code}. This code expires in 15 minutes.`,
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${phoneNumber}`
    });

    logger.info('Verification WhatsApp sent successfully', { phoneNumber });
    return true;
  } catch (error) {
    logger.error('Failed to send verification WhatsApp', { 
      error: error.message, 
      phoneNumber 
    });
    throw new Error('Failed to send verification WhatsApp');
  }
}

/**
 * Send abandoned cart recovery email
 * @param {string} toEmail - Customer email
 * @param {object} cartData - Cart information
 * @param {number} touchNumber - Touch sequence number (1-5)
 * @returns {Promise<boolean>} - Success status
 */
async function sendRecoveryEmail(toEmail, cartData, touchNumber = 1) {
  try {
    const subjectLines = {
      1: `You left something in your cart!`,
      2: `Still thinking about your order?`,
      3: `Your cart is waiting for you`,
      4: `Don't miss out on these items`,
      5: `Last chance to complete your order`
    };

    const msg = {
      to: toEmail,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: subjectLines[touchNumber] || subjectLines[1],
      text: `Hi ${cartData.customerName || 'there'},\n\nWe noticed you left some items in your cart. Complete your purchase now!\n\nCart Total: ${cartData.currency} ${cartData.cartValue}\n\nItems:\n${cartData.items.map(item => `- ${item.name} (${item.quantity}x)`).join('\n')}\n\nComplete your order: ${cartData.recoveryUrl}\n\nBest regards,\nRevluma Team`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Complete your order</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #111111; border-radius: 12px; overflow: hidden;">
                  <!-- Header -->
                  <tr>
                    <td style="padding: 40px 40px 20px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Revluma</h1>
                    </td>
                  </tr>
                  
                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 20px 40px 40px;">
                      <h2 style="margin: 0 0 20px; color: #ffffff; font-size: 24px; font-weight: 600;">${subjectLines[touchNumber] || subjectLines[1]}</h2>
                      <p style="margin: 0 0 20px; color: #a0a0a0; font-size: 16px; line-height: 1.5;">Hi ${cartData.customerName || 'there'},</p>
                      <p style="margin: 0 0 30px; color: #a0a0a0; font-size: 16px; line-height: 1.5;">We noticed you left some items in your cart. Complete your purchase now!</p>
                      
                      <!-- Cart Summary -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px; background-color: #1a1a1a; border-radius: 8px; overflow: hidden;">
                        <tr>
                          <td style="padding: 20px; border-bottom: 1px solid #333333;">
                            <p style="margin: 0; color: #a0a0a0; font-size: 14px;">Cart Total</p>
                            <p style="margin: 5px 0 0; color: #ffffff; font-size: 24px; font-weight: 700;">${cartData.currency} ${cartData.cartValue}</p>
                          </td>
                        </tr>
                        ${cartData.items.map(item => `
                        <tr>
                          <td style="padding: 15px 20px; border-bottom: 1px solid #222222;">
                            <p style="margin: 0; color: #ffffff; font-size: 14px;">${item.name}</p>
                            <p style="margin: 5px 0 0; color: #666666; font-size: 12px;">Qty: ${item.quantity}</p>
                          </td>
                        </tr>
                        `).join('')}
                      </table>
                      
                      <!-- CTA Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px;">
                        <tr>
                          <td align="center">
                            <a href="${cartData.recoveryUrl}" style="display: inline-block; background-color: #ffffff; color: #0a0a0a; text-decoration: none; padding: 16px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">Complete Your Order</a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="margin: 0; color: #666666; font-size: 14px; line-height: 1.5;">If you have any questions about your order, feel free to reach out to our support team.</p>
                    </td>
                  </tr>
                  
                  <!-- Footer -->
                  <tr>
                    <td style="padding: 30px 40px; background-color: #0a0a0a; border-top: 1px solid #222222;">
                      <p style="margin: 0 0 10px; color: #666666; font-size: 12px; text-align: center;">Best regards,</p>
                      <p style="margin: 0; color: #ffffff; font-size: 14px; text-align: center; font-weight: 600;">Revluma Team</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    };

    await sgMail.send(msg);
    logger.info('Recovery email sent successfully', { toEmail, touchNumber });
    return true;
  } catch (error) {
    logger.error('Failed to send recovery email', { 
      error: error.message, 
      toEmail,
      touchNumber 
    });
    throw new Error('Failed to send recovery email');
  }
}

/**
 * Send WhatsApp recovery message
 * @param {string} phoneNumber - Customer phone number
 * @param {object} cartData - Cart information
 * @param {number} touchNumber - Touch sequence number (1-5)
 * @returns {Promise<boolean>} - Success status
 */
async function sendRecoveryWhatsApp(phoneNumber, cartData, touchNumber = 1) {
  try {
    const messages = {
      1: `Hi ${cartData.customerName || 'there'}! 👋 We noticed you left some items in your cart. Your total is ${cartData.currency} ${cartData.cartValue}. Complete your order here: ${cartData.recoveryUrl}`,
      2: `Still thinking about your order? Your cart is waiting! Total: ${cartData.currency} ${cartData.cartValue}. Complete now: ${cartData.recoveryUrl}`,
      3: `Don't miss out! Your cart items are still available. Total: ${cartData.currency} ${cartData.cartValue}. Shop now: ${cartData.recoveryUrl}`,
      4: `Your cart is about to expire! Complete your order for ${cartData.currency} ${cartData.cartValue}. Shop now: ${cartData.recoveryUrl}`,
      5: `Last chance! Complete your order for ${cartData.currency} ${cartData.cartValue} before your cart expires. Shop now: ${cartData.recoveryUrl}`
    };

    const twilio = require('twilio');
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.messages.create({
      body: messages[touchNumber] || messages[1],
      from: `whatsapp:${process.env.TWILIO_WHATSAPP_NUMBER}`,
      to: `whatsapp:${phoneNumber}`
    });

    logger.info('Recovery WhatsApp sent successfully', { phoneNumber, touchNumber });
    return true;
  } catch (error) {
    logger.error('Failed to send recovery WhatsApp', { 
      error: error.message, 
      phoneNumber,
      touchNumber 
    });
    throw new Error('Failed to send recovery WhatsApp');
  }
}

/**
 * Send password reset code email
 */
async function sendPasswordResetEmail(toEmail, code, userName) {
  try {
    const msg = {
      to: toEmail,
      from: {
        email: FROM_EMAIL,
        name: FROM_NAME
      },
      subject: 'Reset your password - ' + FROM_NAME,
      text: `Hi ${userName},

Your password reset code is: ${code}

This code will expire in 15 minutes.

If you didn't request this, please ignore this email.

${FROM_NAME} Team`,
      html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #111111; border-radius: 12px; overflow: hidden;">
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">${FROM_NAME}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px 40px;">
              <h2 style="margin: 0 0 20px; color: #ffffff; font-size: 24px; font-weight: 600;">Reset your password</h2>
              <p style="margin: 0 0 20px; color: #a0a0a0; font-size: 16px; line-height: 1.5;">Hi ${userName},</p>
              <p style="margin: 0 0 30px; color: #a0a0a0; font-size: 16px; line-height: 1.5;">We received a request to reset your password. Use the code below:</p>
              
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 30px;">
                <tr>
                  <td style="background-color: #1a1a1a; border: 2px solid #333333; border-radius: 8px; padding: 30px; text-align: center;">
                    <p style="margin: 0 0 10px; color: #a0a0a0; font-size: 14px; text-transform: uppercase; letter-spacing: 1px;">Your reset code</p>
                    <p style="margin: 0; color: #ffffff; font-size: 36px; font-weight: 700; letter-spacing: 8px; font-family: 'Courier New', monospace;">${code}</p>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 0 0 20px; color: #a0a0a0; font-size: 14px; line-height: 1.5;">This code will expire in <strong style="color: #ffffff;">15 minutes</strong>.</p>
              <p style="margin: 0; color: #666666; font-size: 14px; line-height: 1.5;">If you didn't request this, please ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px 40px; background-color: #0a0a0a; border-top: 1px solid #222222;">
              <p style="margin: 0 0 10px; color: #666666; font-size: 12px; text-align: center;">Best regards,</p>
              <p style="margin: 0; color: #ffffff; font-size: 14px; text-align: center; font-weight: 600;">${FROM_NAME} Team</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
    };

    await sgMail.send(msg);
    logger.info('Password reset email sent', { toEmail });
    return true;
  } catch (error) {
    logger.error('Failed to send password reset email', { 
      error: error.message, 
      toEmail 
    });
    throw new Error('Failed to send password reset email');
  }
}

module.exports = {
  sendVerificationEmail,
  sendWelcomeEmail,
  sendVerificationSMS,
  sendVerificationWhatsApp,
  sendRecoveryEmail,
  sendRecoveryWhatsApp,
  sendPasswordResetEmail
};
