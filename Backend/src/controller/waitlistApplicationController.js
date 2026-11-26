'use strict';

/**
 * Founding Merchants application (the /waitlist page).
 *
 * One waitlist_users row per application, saved step by step. The browser
 * holds a random resume token in an HttpOnly cookie; only its SHA-256 hash is
 * stored. The token is the only thing that authorises reading or changing an
 * application: an email address never does on its own (resuming on another
 * device goes through a one-time code sent to that address).
 *
 * Statuses: in_progress -> submitted -> reviewed / accepted / rejected.
 * Only POST /submit moves a row out of in_progress, and only once every step's
 * stored answers validate.
 */

const crypto = require('node:crypto');
const dbConfig = require('../configs/database');
const emailService = require('../utils/emailService');
const logger = require('../utils/logger');
const { isProductionLikeEnvironment } = require('../utils/cookieOptions');
const { generateUniqueReferralCode } = require('./waitlistController');
const wl = require('../utils/waitlistApplication');

const prisma = dbConfig.prisma;

// ── Responses ───────────────────────────────────────────────────────────────

function fail(res, status, code, error, extra = {}) {
  return res.status(status).json({ success: false, code, error, ...extra });
}

function invalid(res, fields) {
  return fail(res, 400, 'VALIDATION', 'Please check the highlighted answers.', { fields, errors: Object.values(fields) });
}

function ok(res, status, row) {
  return res.status(status).json({ success: true, data: { application: row ? wl.publicView(row) : null } });
}

function noSession(res) {
  return fail(res, 401, 'NO_SESSION', 'We could not find your saved application in this browser. Continue with your email to pick it up again.');
}

// Same answer whatever the reason, and only after a full, valid step 1.
function emailHasApplication(res) {
  return fail(res, 409, 'EMAIL_HAS_APPLICATION', 'This email already has an application. We can email you a code to continue it.');
}

// ── Session cookie ──────────────────────────────────────────────────────────

function cookieOptions(req, maxAge) {
  const secure = isProductionLikeEnvironment({
    NODE_ENV: process.env.NODE_ENV,
    RENDER: process.env.RENDER,
    VERCEL: process.env.VERCEL,
    FORWARDED_PROTO: req.headers?.['x-forwarded-proto'],
  });
  // First-party only: the page reaches this API through the same-origin
  // /api/waitlist proxy on the site, so the cookie never needs to cross sites.
  return { httpOnly: true, secure, sameSite: 'strict', path: '/api', ...(maxAge === undefined ? {} : { maxAge }) };
}

function setSessionCookie(req, res, token) {
  res.cookie(wl.RESUME_COOKIE, token, cookieOptions(req, wl.RESUME_TTL_MS));
}

function clearSessionCookie(req, res) {
  res.clearCookie(wl.RESUME_COOKIE, cookieOptions(req));
}

function presentedToken(req) {
  const token = req.cookies?.[wl.RESUME_COOKIE];
  return wl.isWellFormedToken(token) ? token : null;
}

async function loadSession(req) {
  const token = presentedToken(req);
  if (!token) return null;
  const row = await prisma.waitlist_users.findUnique({ where: { resume_token_hash: wl.hashToken(token) } });
  if (!row || !row.resume_token_expires_at) return null;
  if (new Date(row.resume_token_expires_at).getTime() <= Date.now()) return null;
  return row;
}

function sessionExpiry() {
  return new Date(Date.now() + wl.RESUME_TTL_MS);
}

function clientMeta(req) {
  return {
    ip_address: req.ip || null,
    user_agent: String(req.get?.('user-agent') || '').slice(0, 400) || null,
  };
}

// Only a code that belongs to a submitted applicant earns credit, as before:
// unknown codes are dropped quietly instead of blocking the application.
async function resolveReferrer(raw) {
  const code = wl.normaliseReferralCode(raw);
  if (!code) return null;
  const referrer = await prisma.waitlist_users.findUnique({ where: { referral_code: code }, select: { referral_code: true } });
  return referrer ? referrer.referral_code : null;
}

function isUniqueViolation(error, field) {
  if (error?.code !== 'P2002') return false;
  return field ? JSON.stringify(error.meta?.target || '').includes(field) : true;
}

// ── Step saving ─────────────────────────────────────────────────────────────

async function saveStepOnRow(res, row, step, data) {
  if (step === 1 && data.work_email !== row.work_email) {
    const other = await prisma.waitlist_users.findUnique({ where: { work_email: data.work_email }, select: { id: true } });
    if (other && other.id !== row.id) return emailHasApplication(res);
  }
  const now = new Date();
  let saved;
  try {
    // Answers only change while the application is in progress, and the
    // furthest step reached only moves forward, so a late duplicate or an
    // edit of an earlier step can never undo progress or reopen a submission.
    [saved] = await prisma.$transaction([
      prisma.waitlist_users.updateMany({
        where: { id: row.id, status: 'in_progress' },
        data: { ...wl.stepColumns(step, data), updated_at: now },
      }),
      prisma.waitlist_users.updateMany({
        where: { id: row.id, status: 'in_progress', current_step: { lt: step + 1 } },
        data: { current_step: step + 1 },
      }),
    ]);
  } catch (error) {
    if (isUniqueViolation(error, 'work_email')) return emailHasApplication(res);
    throw error;
  }
  const fresh = await prisma.waitlist_users.findUnique({ where: { id: row.id } });
  if (!saved.count) {
    return fail(res, 409, 'ALREADY_SUBMITTED', 'This application has already been submitted.', { data: { application: wl.publicView(fresh) } });
  }
  logger.info('waitlist_application_step_saved', { step });
  return ok(res, 200, fresh);
}

// POST /application/start: step 1 for a browser without an application.
exports.start = async (req, res, next) => {
  try {
    const body = req.body || {};
    const checked = wl.validateStep1(body);

    // Honeypot: real people never see this field. Answer like a success so a
    // bot learns nothing, but store nothing and issue no session.
    if (body.hp_field) {
      logger.warn('waitlist_application_honeypot');
      if (!checked.ok) return invalid(res, checked.errors);
      return res.status(201).json({
        success: true,
        data: { application: wl.publicView({ status: 'in_progress', current_step: 2, ...wl.stepColumns(1, checked.data) }) },
      });
    }

    if (!checked.ok) return invalid(res, checked.errors);
    const data = checked.data;

    const session = await loadSession(req);
    if (session) {
      if (session.status !== 'in_progress') {
        return fail(res, 409, 'ALREADY_SUBMITTED', 'This application has already been submitted.', { data: { application: wl.publicView(session) } });
      }
      return saveStepOnRow(res, session, 1, data);
    }

    // Idempotency-Key: a retry or duplicate of the same first save (double
    // click, lost response) gets the same application and the same cookie
    // back, never a second row.
    const key = req.get('idempotency-key');
    const keyHash = wl.isWellFormedIdempotencyKey(key) ? wl.hashToken(`start:${key}`) : null;
    const replayOf = async () => {
      const replay = await prisma.waitlist_users.findUnique({ where: { start_key_hash: keyHash } });
      if (!replay) return null;
      const token = wl.startToken(keyHash);
      const fresh = replay.created_at && Date.now() - new Date(replay.created_at).getTime() < wl.START_REPLAY_WINDOW_MS;
      // Only while the first token is still the live one: once the session
      // has rotated (a later visit), the key no longer opens anything.
      if (!fresh || replay.status !== 'in_progress' || replay.work_email !== data.work_email || replay.resume_token_hash !== wl.hashToken(token)) {
        return fail(res, 409, 'START_REPLAY_REJECTED', 'Refresh the page to continue your application.');
      }
      setSessionCookie(req, res, token);
      // Same answers as the original request in practice; saving them again
      // keeps an edited retry from being silently dropped.
      return saveStepOnRow(res, replay, 1, data);
    };
    if (keyHash) {
      const replayed = await replayOf();
      if (replayed) return replayed;
    }

    const existing = await prisma.waitlist_users.findUnique({ where: { work_email: data.work_email }, select: { id: true } });
    if (existing) return emailHasApplication(res);

    const referredBy = await resolveReferrer(body.referral_code);
    const token = keyHash ? wl.startToken(keyHash) : wl.newResumeToken();
    const now = new Date();
    let row;
    try {
      row = await prisma.waitlist_users.create({
        data: {
          id: crypto.randomUUID(),
          ...wl.stepColumns(1, data),
          // Legacy NOT NULL profile columns this application does not collect.
          industry: '',
          country: '',
          biggest_challenge: '',
          status: 'in_progress',
          current_step: 2,
          referred_by_code: referredBy,
          referral_count: 0,
          lead_score: 0,
          interested_in_beta: true,
          is_founding_member: false,
          welcome_email_sent: false,
          resume_token_hash: wl.hashToken(token),
          resume_token_expires_at: sessionExpiry(),
          start_key_hash: keyHash,
          ...clientMeta(req),
          created_at: now,
          updated_at: now,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error, 'start_key_hash')) {
        // A duplicate of this request won the race: answer like it did.
        const replayed = await replayOf();
        if (replayed) return replayed;
        return fail(res, 409, 'START_IN_FLIGHT', 'Your first step is still saving. Please wait a moment.');
      }
      if (isUniqueViolation(error)) return emailHasApplication(res);
      throw error;
    }
    setSessionCookie(req, res, token);
    logger.info('waitlist_application_started', { referred: Boolean(referredBy) });
    return ok(res, 201, row);
  } catch (error) {
    return next(error);
  }
};

// PUT /application/steps/:step
exports.saveStep = async (req, res, next) => {
  try {
    const step = Number(req.params.step);
    if (![1, 2, 3].includes(step)) return fail(res, 404, 'NOT_FOUND', 'Unknown step.');
    const checked = wl.STEP_VALIDATORS[step](req.body || {});
    if (!checked.ok) return invalid(res, checked.errors);

    const session = await loadSession(req);
    if (!session) return noSession(res);
    if (session.status !== 'in_progress') {
      return fail(res, 409, 'ALREADY_SUBMITTED', 'This application has already been submitted.', { data: { application: wl.publicView(session) } });
    }
    if (step > 1 && (Number(session.current_step) || 1) < step) {
      return fail(res, 409, 'STEP_LOCKED', 'Finish the earlier steps first.', { data: { application: wl.publicView(session) } });
    }
    return saveStepOnRow(res, session, step, checked.data);
  } catch (error) {
    return next(error);
  }
};

// GET /application/resume: the saved answers and where to pick up. Renews
// (rotates) the session token on every visit.
exports.resume = async (req, res, next) => {
  try {
    const session = await loadSession(req);
    if (!session) {
      if (req.cookies?.[wl.RESUME_COOKIE]) clearSessionCookie(req, res);
      return ok(res, 200, null);
    }
    const token = wl.newResumeToken();
    // Conditional on the presented token, so two tabs loading at once cannot
    // hand the browser a token that has already been replaced.
    const { count } = await prisma.waitlist_users.updateMany({
      where: { id: session.id, resume_token_hash: session.resume_token_hash },
      data: { resume_token_hash: wl.hashToken(token), resume_token_expires_at: sessionExpiry() },
    });
    if (count) setSessionCookie(req, res, token);
    return ok(res, 200, session);
  } catch (error) {
    return next(error);
  }
};

// GET /application/status: where the application stands, without answers.
exports.status = async (req, res, next) => {
  try {
    const session = await loadSession(req);
    if (!session) return res.status(200).json({ success: true, data: { status: null } });
    const view = wl.publicView(session);
    return res.status(200).json({
      success: true,
      data: { status: view.status, current_step: view.current_step, submitted_at: view.submitted_at, queue_position: view.queue_position },
    });
  } catch (error) {
    return next(error);
  }
};

async function sendConfirmation(row) {
  try {
    await emailService.sendWelcomeEmail(row.work_email, { full_name: row.full_name, waitlist_position: row.waitlist_position });
    await prisma.waitlist_users.update({ where: { id: row.id }, data: { welcome_email_sent: true } });
  } catch (error) {
    logger.error('waitlist_welcome_email_failed', { error_type: error?.code || error?.name || 'email_provider_error' });
  }
}

// POST /application/submit
exports.submit = async (req, res, next) => {
  try {
    const session = await loadSession(req);
    if (!session) return noSession(res);
    if (session.status !== 'in_progress') return ok(res, 200, session); // already submitted: same answer, no second email

    const incomplete = wl.firstIncompleteStep(session) || ((Number(session.current_step) || 1) < wl.REVIEW_STEP ? Number(session.current_step) || 1 : null);
    if (incomplete) {
      return fail(res, 409, 'INCOMPLETE', 'Some answers are missing. Please finish that step first.', { step: incomplete, data: { application: wl.publicView(session) } });
    }

    const now = new Date();
    const outcome = await prisma.$transaction(async (tx) => {
      // Serialises submissions so every applicant gets a distinct, gap-free
      // place in the review queue.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('waitlist_users.waitlist_position'))`;
      const current = await tx.waitlist_users.findUnique({ where: { id: session.id } });
      if (!current || current.status !== 'in_progress') return { row: current, submittedNow: false };
      const last = await tx.waitlist_users.findFirst({
        where: { waitlist_position: { not: null } },
        orderBy: { waitlist_position: 'desc' },
        select: { waitlist_position: true },
      });
      const ownCode = current.referral_code || (await generateUniqueReferralCode(tx));
      const row = await tx.waitlist_users.update({
        where: { id: current.id },
        data: {
          status: 'submitted',
          submitted_at: now,
          updated_at: now,
          current_step: wl.REVIEW_STEP,
          waitlist_position: (last?.waitlist_position || 0) + 1,
          referral_code: ownCode,
          resume_token_expires_at: sessionExpiry(),
        },
      });
      // Credit the referrer once, when the referred application is complete.
      if (current.referred_by_code && current.referred_by_code !== ownCode) {
        await tx.waitlist_users.updateMany({
          where: { referral_code: current.referred_by_code },
          data: { referral_count: { increment: 1 } },
        });
      }
      return { row, submittedNow: true };
    });

    if (outcome.submittedNow) {
      logger.info('waitlist_application_submitted', { referred: Boolean(outcome.row.referred_by_code) });
      await sendConfirmation(outcome.row);
      const token = presentedToken(req);
      if (token) setSessionCookie(req, res, token);
    }
    return ok(res, 200, outcome.row);
  } catch (error) {
    return next(error);
  }
};

// POST /application/resume/request-code: continue on another device. The
// answer is identical whether or not the email has an application.
exports.requestResumeCode = async (req, res, next) => {
  try {
    const email = wl.normaliseEmail(req.body?.email);
    if (!email) return invalid(res, { email: 'Enter a valid email address.' });
    const generic = () => res.status(202).json({
      success: true,
      message: 'If that email has an application, a 6-digit code is on its way. It expires in 15 minutes.',
    });

    const row = await prisma.waitlist_users.findUnique({
      where: { work_email: email },
      select: { id: true, full_name: true, resume_code_expires_at: true },
    });
    if (!row) return generic();
    const sentAt = row.resume_code_expires_at ? new Date(row.resume_code_expires_at).getTime() - wl.RESUME_CODE_TTL_MS : 0;
    if (Date.now() - sentAt < wl.RESUME_CODE_RESEND_MS) return generic();

    const code = wl.newResumeCode();
    await prisma.waitlist_users.update({
      where: { id: row.id },
      data: {
        resume_code_hash: wl.hashResumeCode(code, row.id),
        resume_code_expires_at: new Date(Date.now() + wl.RESUME_CODE_TTL_MS),
        resume_code_attempts: 0,
      },
    });
    // Not awaited: the response time must not reveal that an email was sent.
    Promise.resolve()
      .then(() => emailService.sendWaitlistResumeCode(email, { full_name: row.full_name, code }))
      .catch((error) => logger.error('waitlist_resume_code_email_failed', { error_type: error?.code || error?.name || 'email_provider_error' }));
    return generic();
  } catch (error) {
    return next(error);
  }
};

// POST /application/resume/verify-code
exports.verifyResumeCode = async (req, res, next) => {
  try {
    const email = wl.normaliseEmail(req.body?.email);
    const code = String(req.body?.code ?? '').replace(/\s+/g, '');
    const rejected = () => fail(res, 400, 'CODE_INVALID', 'That code is not valid or has expired. Request a new one.');
    if (!email || !/^\d{6}$/.test(code)) return rejected();

    const row = await prisma.waitlist_users.findUnique({ where: { work_email: email } });
    if (!row || !row.resume_code_hash || !row.resume_code_expires_at) return rejected();
    if (new Date(row.resume_code_expires_at).getTime() <= Date.now()) return rejected();
    if ((row.resume_code_attempts || 0) >= wl.RESUME_CODE_MAX_ATTEMPTS) return rejected();

    if (!wl.safeEqualHex(wl.hashResumeCode(code, row.id), row.resume_code_hash)) {
      await prisma.waitlist_users.updateMany({
        where: { id: row.id, resume_code_attempts: { lt: wl.RESUME_CODE_MAX_ATTEMPTS } },
        data: { resume_code_attempts: { increment: 1 } },
      });
      return rejected();
    }

    // One use only: consumed together with issuing the new session, which
    // also signs out any other browser holding the previous token.
    const token = wl.newResumeToken();
    const { count } = await prisma.waitlist_users.updateMany({
      where: { id: row.id, resume_code_hash: row.resume_code_hash },
      data: {
        resume_code_hash: null,
        resume_code_expires_at: null,
        resume_code_attempts: 0,
        resume_token_hash: wl.hashToken(token),
        resume_token_expires_at: sessionExpiry(),
      },
    });
    if (!count) return rejected();
    setSessionCookie(req, res, token);
    const fresh = await prisma.waitlist_users.findUnique({ where: { id: row.id } });
    logger.info('waitlist_application_resumed_by_code');
    return ok(res, 200, fresh);
  } catch (error) {
    return next(error);
  }
};

// DELETE /application/session: "Not you?" Forget the application in this
// browser. The saved answers stay and can be picked up again by email.
exports.endSession = async (req, res) => {
  clearSessionCookie(req, res);
  return res.status(200).json({ success: true, data: { application: null } });
};

// Exported for tests.
exports._internals = { cookieOptions, loadSession };
