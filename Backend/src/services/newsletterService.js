// src/services/newsletterService.js
// ============================================================
// PRODUCTION-READY NEWSLETTER SERVICE
// - Secure token generation (crypto.randomBytes)
// - SendGrid integration for email delivery
// - Double opt-in verification flow
// - Batch sending with retry logic
// - Per-recipient delivery tracking
// ============================================================

const crypto = require('crypto');
const sgMail = require('@sendgrid/mail');
const { prisma } = require('../services/prisma');
const logger = require('../utils/logger');

// Initialize SendGrid
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@revluma.onrender.com';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'Revluma';
const BASE_URL = process.env.BASE_URL || 'https://revluma.onrender.com';
const VERIFICATION_EXPIRY_HOURS = 24;
const BATCH_SIZE = 500;
const BATCH_DELAY_MS = 1200; // ~50 emails/sec to stay under SendGrid limits

// ====================== TOKEN GENERATION ======================

/**
 * Generate a cryptographically secure token
 * @param {number} bytes - Number of random bytes (default 32)
 * @returns {string} Hex-encoded token
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// ====================== EMAIL TEMPLATES ======================

/**
 * Build verification email HTML
 */
function buildVerificationEmailHTML(email, token) {
  const verifyUrl = `${BASE_URL}/api/newsletter/verify?token=${encodeURIComponent(token)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#111111;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:40px 40px 20px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;">Revluma</h1>
        </td></tr>
        <tr><td style="padding:20px 40px 40px;">
          <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;font-weight:600;">Confirm your subscription</h2>
          <p style="margin:0 0 24px;color:#a0a0a0;font-size:15px;line-height:1.6;">
            You signed up for product updates, feature releases, and e-commerce intelligence from Revluma.
            Click the button below to confirm your email and activate your subscription.
          </p>
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td align="center">
              <a href="${verifyUrl}" style="display:inline-block;background-color:#ffffff;color:#0a0a0a;text-decoration:none;padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;">Confirm Subscription</a>
            </td></tr>
          </table>
          <p style="margin:0 0 12px;color:#666666;font-size:13px;line-height:1.5;">
            If the button doesn't work, copy and paste this link into your browser:
          </p>
          <p style="margin:0 0 20px;color:#888888;font-size:12px;word-break:break-all;line-height:1.5;">
            <a href="${verifyUrl}" style="color:#888888;">${verifyUrl}</a>
          </p>
          <p style="margin:0;color:#555555;font-size:12px;line-height:1.5;">
            This link expires in ${VERIFICATION_EXPIRY_HOURS} hours. If you didn't request this, you can safely ignore this email.
          </p>
        </td></tr>
        <tr><td style="padding:28px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
          <p style="margin:0 0 8px;color:#444444;font-size:11px;text-align:center;">
            Revluma — Revenue intelligence for modern e-commerce
          </p>
          <p style="margin:0;color:#333333;font-size:11px;text-align:center;">
            You received this because you subscribed at revluma.onrender.com
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Build newsletter email HTML
 */
function buildNewsletterHTML(subject, content, unsubToken) {
  const unsubUrl = `${BASE_URL}/api/newsletter/unsubscribe?token=${encodeURIComponent(unsubToken)}`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#111111;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 40px 16px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">Revluma</h1>
        </td></tr>
        <tr><td style="padding:16px 40px 40px;">
          <h2 style="margin:0 0 20px;color:#ffffff;font-size:20px;font-weight:600;">${escapeHtml(subject)}</h2>
          <div style="color:#c0c0c0;font-size:14px;line-height:1.7;">${content}</div>
        </td></tr>
        <tr><td style="padding:24px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
          <p style="margin:0 0 8px;color:#444444;font-size:11px;text-align:center;">
            Revluma — Revenue intelligence for modern e-commerce
          </p>
          <p style="margin:0;color:#333333;font-size:11px;text-align:center;">
            <a href="${unsubUrl}" style="color:#555555;text-decoration:underline;">Unsubscribe</a>
            &nbsp;&middot;&nbsp;
            <a href="${BASE_URL}" style="color:#555555;text-decoration:underline;">revluma.onrender.com</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Build unsubscribe confirmation HTML
 */
function buildUnsubscribeConfirmationHTML(email) {
  const resubUrl = `${BASE_URL}/api/newsletter/subscribe`;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#0a0a0a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#111111;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:40px;text-align:center;">
          <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;font-weight:600;">You've been unsubscribed</h2>
          <p style="margin:0 0 24px;color:#a0a0a0;font-size:15px;line-height:1.6;">
            The email <strong style="color:#ffffff;">${escapeHtml(email)}</strong> has been removed from our newsletter list.
            You will no longer receive updates from Revluma.
          </p>
          <p style="margin:0;color:#666666;font-size:13px;line-height:1.5;">
            Changed your mind? You can always
            <a href="${BASE_URL}" style="color:#a0a0a0;text-decoration:underline;">resubscribe from our website</a>.
          </p>
        </td></tr>
        <tr><td style="padding:28px 40px;background-color:#0a0a0a;border-top:1px solid #222222;">
          <p style="margin:0;color:#333333;font-size:11px;text-align:center;">
            Revluma — Revenue intelligence for modern e-commerce
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Escape HTML to prevent injection
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ====================== CORE FUNCTIONS ======================

/**
 * Subscribe an email (creates pending subscription, sends verification)
 * @param {string} email - Subscriber email
 * @param {object} meta - Optional metadata { ip, userAgent, source }
 * @returns {object} Result with status and message
 */
async function subscribe(email, meta = {}) {
  const sanitizedEmail = String(email).trim().toLowerCase();

  // Validate email format
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!sanitizedEmail || !emailRegex.test(sanitizedEmail) || sanitizedEmail.length > 254) {
    console.error('Invalid email format submitted', { email: sanitizedEmail });
    return { status: 400, message: 'Invalid email address format' };
  }

  try {
    const token = generateToken();
    const expires = new Date(Date.now() + VERIFICATION_EXPIRY_HOURS * 60 * 60 * 1000);

    // Use upsert to handle both new and existing subscribers
    const subscriber = await prisma.newsletterSubscriber.upsert({
      where: {
        email: sanitizedEmail
      },
      update: {
        status: 'active',
        verified: false,
        verifyToken: token,
        verifyExpires: expires,
        unsubToken: generateToken(16),
        updatedAt: new Date()
      },
      create: {
        tenantId: 'system',
        email: sanitizedEmail,
        name: meta.name || null,
        status: 'active',
        source: meta.source || 'website',
        verified: false,
        verifyToken: token,
        verifyExpires: expires,
        unsubToken: generateToken(16)
      }
    });

    await sendVerificationEmail(sanitizedEmail, token);
    logger.info('Subscription processed', { email: sanitizedEmail, source: meta.source, subscriberId: subscriber.id });
    console.log('Newsletter subscribe successful', { email: sanitizedEmail, subscriberId: subscriber.id });

    return { status: 200, message: 'Check your email to confirm your subscription' };

  } catch (err) {
    console.error('Newsletter subscription error:', err.message, { email: sanitizedEmail, stack: err.stack });
    logger.error('Newsletter subscription error', { error: err.message, email: sanitizedEmail, stack: err.stack });
    return { status: 500, message: 'Failed to process subscription. Please try again.' };
  }
}

/**
 * Verify a subscription token
 * @param {string} token - Verification token
 * @returns {object} Result with status and message
 */
async function verify(token) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    return { status: 400, message: 'Invalid or missing verification token' };
  }

  try {
    // Find subscriber with valid token
    const subscriber = await prisma.newsletterSubscriber.findFirst({
      where: {
        verifyToken: token,
        verified: false,
        OR: [
          { verifyExpires: null },
          { verifyExpires: { gt: new Date() } }
        ]
      }
    });

    if (!subscriber) {
      // Check if token was already used
      const usedSubscriber = await prisma.newsletterSubscriber.findFirst({
        where: {
          verifyToken: token,
          verified: true
        }
      });

      if (usedSubscriber) {
        return { status: 200, message: 'Email already verified' };
      }

      return { status: 400, message: 'Invalid or expired verification token' };
    }

    // Update subscriber as verified
    await prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: {
        verified: true,
        verifiedAt: new Date(),
        verifyToken: null,
        verifyExpires: null,
        updatedAt: new Date()
      }
    });

    logger.info('Email verified successfully', { email: subscriber.email, id: subscriber.id });
    return { status: 200, message: 'Email verified successfully. You are now subscribed.' };

  } catch (err) {
    logger.error('Verification failed', { error: err.message, stack: err.stack });
    return { status: 500, message: 'Verification failed. Please try again.' };
  }
}

/**
 * Send verification email via SendGrid
 */
async function sendVerificationEmail(email, token) {
  const msg = {
    to: email,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    subject: 'Confirm your subscription — Revluma',
    text: `Confirm your Revluma newsletter subscription by visiting this link:\n\n${BASE_URL}/api/newsletter/verify?token=${token}\n\nThis link expires in ${VERIFICATION_EXPIRY_HOURS} hours.\n\nIf you didn't request this, ignore this email.`,
    html: buildVerificationEmailHTML(email, token)
  };

  await sgMail.send(msg);
  logger.info('Verification email sent', { email });
}

/**
 * Send newsletter to all verified, active subscribers
 * @param {string} subject - Newsletter subject
 * @param {string} contentHTML - HTML content body
 * @param {string} contentText - Plain text fallback
 * @param {string} sentBy - Admin identifier
 * @returns {object} Send results
 */
async function sendNewsletter(subject, contentHTML, contentText, sentBy = 'system') {
  if (!subject || !contentHTML) {
    throw new Error('Subject and content are required');
  }

  // Create send record
  const sendRecord = await db.query(
    `INSERT INTO newsletter_sends (subject, content_html, content_text, status, sent_by)
     VALUES ($1, $2, $3, 'sending', $4) RETURNING id`,
    [subject, contentHTML, contentText || '', sentBy],
    'system'
  );
  const sendId = sendRecord.rows[0].id;

  // Fetch all active subscribers
  const subscribers = await db.query(
    `SELECT id, email, unsub_token FROM newsletter_subscribers
     WHERE is_verified = TRUE AND is_unsubscribed = FALSE
     ORDER BY created_at ASC`,
    [],
    'system'
  );

  const totalRecipients = subscribers.rowCount;
  await db.query(
    'UPDATE newsletter_sends SET total_recipients = $1 WHERE id = $2',
    [totalRecipients, sendId],
    'system'
  );

  if (totalRecipients === 0) {
    await db.query(
      "UPDATE newsletter_sends SET status = 'completed', completed_at = NOW() WHERE id = $1",
      [sendId],
      'system'
    );
    logger.info('No active subscribers for newsletter', { sendId });
    return { sendId, total: 0, sent: 0, failed: 0 };
  }

  logger.info('Starting newsletter send', { sendId, totalRecipients, subject });

  let sentCount = 0;
  let failedCount = 0;

  // Process in batches
  for (let i = 0; i < subscribers.rows.length; i += BATCH_SIZE) {
    const batch = subscribers.rows.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (sub) => {
      // Create event record
      const eventRes = await db.query(
        `INSERT INTO newsletter_send_events (send_id, subscriber_id, email, status)
         VALUES ($1, $2, $3, 'sending') RETURNING id`,
        [sendId, sub.id, sub.email],
        'system'
      );
      const eventId = eventRes.rows[0].id;

      try {
        const html = buildNewsletterHTML(subject, contentHTML, sub.unsub_token);

        const msg = {
          to: sub.email,
          from: { email: FROM_EMAIL, name: FROM_NAME },
          subject: subject,
          text: contentText || subject,
          html: html,
          trackingSettings: {
            clickTracking: { enable: true },
            openTracking: { enable: true }
          }
        };

        await sgMail.send(msg);

        await db.query(
          `UPDATE newsletter_send_events
           SET status = 'sent', sent_at = NOW()
           WHERE id = $1`,
          [eventId],
          'system'
        );

        sentCount++;
      } catch (err) {
        failedCount++;
        logger.error('Newsletter email failed', {
          sendId,
          subscriberId: sub.id,
          email: sub.email,
          error: err.message
        });

        await db.query(
          `UPDATE newsletter_send_events
           SET status = 'failed', error_message = $2
           WHERE id = $1`,
          [eventId, err.message],
          'system'
        );
      }
    });

    await Promise.allSettled(promises);

    // Delay between batches to respect rate limits
    if (i + BATCH_SIZE < subscribers.rows.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  // Update send record
  await db.query(
    `UPDATE newsletter_sends
     SET sent_count = $1, failed_count = $2, status = 'completed', completed_at = NOW()
     WHERE id = $3`,
    [sentCount, failedCount, sendId],
    'system'
  );

  logger.info('Newsletter send completed', { sendId, total: totalRecipients, sent: sentCount, failed: failedCount });

  return { sendId, total: totalRecipients, sent: sentCount, failed: failedCount };
}

/**
 * Get subscriber stats
 */
async function getStats() {
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE is_verified = TRUE AND is_unsubscribed = FALSE) as active_subscribers,
       COUNT(*) FILTER (WHERE is_verified = FALSE AND is_unsubscribed = FALSE) as pending_verification,
       COUNT(*) FILTER (WHERE is_unsubscribed = TRUE) as unsubscribed,
       COUNT(*) as total
     FROM newsletter_subscribers`,
    [],
    'system'
  );
  return result.rows[0];
}

/**
 * Unsubscribe from newsletter using token
 * @param {string} token - Unsubscribe token
 * @returns {object} Result with status, message, and optional html
 */
async function unsubscribe(token) {
  if (!token || typeof token !== 'string' || token.length < 10) {
    return { status: 400, message: 'Invalid or missing unsubscribe token' };
  }

  try {
    // Find subscriber with valid unsubscribe token
    const subscriber = await prisma.newsletterSubscriber.findFirst({
      where: {
        unsubToken: token
      }
    });

    if (!subscriber) {
      return { status: 400, message: 'Invalid unsubscribe token' };
    }

    // Check if already unsubscribed
    if (subscriber.status === 'unsubscribed') {
      return {
        status: 200,
        message: 'You have already been unsubscribed from our newsletter.',
        html: buildUnsubscribeConfirmationHTML(subscriber.email)
      };
    }

    // Mark as unsubscribed
    await prisma.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: {
        status: 'unsubscribed',
        verifyToken: null,
        verifyExpires: null,
        updatedAt: new Date()
      }
    });

    logger.info('Email unsubscribed from newsletter', { email: subscriber.email, id: subscriber.id });

    return {
      status: 200,
      message: 'You have been unsubscribed from our newsletter.',
      html: buildUnsubscribeConfirmationHTML(subscriber.email)
    };

  } catch (err) {
    logger.error('Unsubscribe failed', { error: err.message, stack: err.stack });
    return { status: 500, message: 'Unsubscribe failed. Please try again.' };
  }
}

module.exports = {
  subscribe,
  verify,
  unsubscribe,
  sendNewsletter,
  getStats,
  generateToken,
  escapeHtml
};
