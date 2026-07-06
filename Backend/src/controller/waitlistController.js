const { validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const dbConfig = require('../configs/database');
const emailService = require('../utils/emailService');
const { getCached, setCached } = require('../utils/referralCache');

const prisma = dbConfig.prisma;

// Helper function to calculate lead score
function calculateLeadScore(data) {
  let score = 0;

  // Team size scoring
  const teamSizeScores = {
    '1': 10,
    '2-5': 20,
    '6-10': 30,
    '11-25': 40,
    '26-50': 45,
    '50+': 50,
  };
  score += teamSizeScores[data.team_size] || 0;

  // Monthly revenue scoring
  const revenueScores = {
    '<10k': 10,
    '10k-50k': 20,
    '50k-100k': 30,
    '100k-500k': 40,
    '500k-1m': 45,
    '1m+': 50,
  };
  score += revenueScores[data.monthly_revenue_range] || 0;

  // Problem scoring (each problem = +15 points)
  if (data.current_churn_problem) score += 15;
  if (data.abandoned_cart_problem) score += 15;
  if (data.retention_problem) score += 15;
  if (data.revenue_visibility_problem) score += 15;

  // Beta interest bonus
  if (data.interested_in_beta) score += 10;

  return Math.min(score, 200); // Cap at 200
}

// Generates a short, shareable referral code, e.g. "RV-4F8A2B".
// Not cryptographically sensitive — it's a public shareable token, not a
// secret — so a short random hex suffix is fine.
function generateReferralCode() {
  return `RV-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

// Generates a referral code and confirms it's actually unique against the
// DB before handing it back, retrying on the rare collision. Must be run
// with a Prisma client that supports .waitlist_users (either the main
// `prisma` instance or a `tx` transaction client) so the uniqueness check
// and the row insert that uses this code stay consistent.
async function generateUniqueReferralCode(client, attempts = 5) {
  for (let i = 0; i < attempts; i++) {
    const code = generateReferralCode();
    const existing = await client.waitlist_users.findUnique({
      where: { referral_code: code },
      select: { id: true },
    });
    if (!existing) return code;
  }
  throw new Error('Failed to generate a unique referral code after multiple attempts');
}

// Referral codes are user-facing tokens people type in manually, so this
// normalizes casing/whitespace before any lookup, cache hit, or DB write —
// "rv-4f8a2b", " RV-4F8A2B ", and "RV-4F8A2B" must all resolve to the
// same code.
function normalizeReferralCode(code) {
  return typeof code === 'string' ? code.trim().toUpperCase() : null;
}

exports.joinWaitlist = async (req, res, next) => {
  try {
    // Honeypot bots tend to fill every field they can find; real users never
    // see this one (it's visually hidden off-screen). If it's filled, pretend
    // to succeed without touching the DB or sending an email, so the bot has
    // no signal that it was caught.
    if (req.body.hp_field) {
      console.warn(
        `[waitlist] honeypot triggered — email: ${req.body.work_email || 'n/a'}, ip: ${req.ip}, ua: ${req.get('user-agent') || 'n/a'}`
      );
      return res.status(201).json({
        success: true,
        message: 'Successfully joined the waitlist!',
        data: { waitlist_position: 0 },
      });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array().map((err) => err.msg),
      });
    }

    const {
      full_name,
      work_email,
      phone_number,
      twitter_handle,
      tiktok_handle,
      instagram_handle,
      company_name,
      website_url,
      store_url,
      industry,
      country,
      state_region,
      team_size,
      monthly_revenue_range,
      monthly_order_volume,
      ecommerce_platform,
      email_platform,
      analytics_platform,
      support_platform,
      ad_platform,
      primary_goal,
      biggest_challenge,
      current_churn_problem,
      abandoned_cart_problem,
      retention_problem,
      revenue_visibility_problem,
      why_join_waitlist,
      interested_in_beta,
      referred_by_code,
    } = req.body;

    // Check if email already exists
    const existingWaitlistUser = await prisma.waitlist_users.findUnique({
      where: { work_email },
    });

    if (existingWaitlistUser) {
      return res.status(400).json({
        success: false,
        error: 'This email is already on the waitlist',
      });
    }

    // Calculate lead score based on answers
    const leadScore = calculateLeadScore({
      team_size,
      monthly_revenue_range,
      interested_in_beta,
      current_churn_problem,
      abandoned_cart_problem,
      retention_problem,
      revenue_visibility_problem,
    });

    const normalizedReferredByCode = normalizeReferralCode(referred_by_code);

    // Everything below happens inside one transaction: resolving the
    // referrer, generating this user's own unique code, computing their
    // waitlist position, creating the row, and crediting the referrer's
    // referral_count. Doing it all together means a crash or concurrent
    // request can't leave things half-applied (e.g. a referral credited
    // with no matching signup, or a signup with no position).
    const result = await prisma.$transaction(async (tx) => {
      let referrer = null;

      if (normalizedReferredByCode) {
        referrer = await tx.waitlist_users.findUnique({
          where: { referral_code: normalizedReferredByCode },
          select: { id: true, referral_code: true },
        });
        // If the code doesn't match anyone, we don't reject the signup —
        // the frontend already checks and warns about invalid codes live,
        // before the person even submits. Re-validating here (rather than
        // trusting the frontend) just means an invalid/spoofed code quietly
        // gets no credit, instead of blocking a legitimate signup over a
        // stale or mistyped code.
      }

      const ownReferralCode = await generateUniqueReferralCode(tx);

      const lastWaitlistUser = await tx.waitlist_users.findFirst({
        orderBy: { waitlist_position: 'desc' },
        select: { waitlist_position: true },
      });
      const nextPosition = (lastWaitlistUser?.waitlist_position || 0) + 1;

      const newUser = await tx.waitlist_users.create({
        data: {
          id: uuidv4(),
          full_name,
          work_email,
          phone_number: phone_number || null,
          twitter_handle: twitter_handle || null,
          tiktok_handle: tiktok_handle || null,
          instagram_handle: instagram_handle || null,
          company_name,
          website_url: website_url || null,
          store_url: store_url || null,
          // industry/country/biggest_challenge are NOT NULL columns but are no
          // longer collected in step 1, they're filled in later via
          // updateWaitlistDetails (step 2). Empty string satisfies the
          // constraint without a schema change; treated as "not yet provided".
          industry: industry || '',
          country: country || '',
          state_region: state_region || null,
          team_size: team_size || null,
          monthly_revenue_range: monthly_revenue_range || null,
          monthly_order_volume: monthly_order_volume || null,
          ecommerce_platform: ecommerce_platform || null,
          email_platform: email_platform || null,
          analytics_platform: analytics_platform || null,
          support_platform: support_platform || null,
          ad_platform: ad_platform || null,
          primary_goal: primary_goal || null,
          biggest_challenge: biggest_challenge || '',
          current_churn_problem: Boolean(current_churn_problem),
          abandoned_cart_problem: Boolean(abandoned_cart_problem),
          retention_problem: Boolean(retention_problem),
          revenue_visibility_problem: Boolean(revenue_visibility_problem),
          why_join_waitlist: why_join_waitlist || null,
          interested_in_beta: interested_in_beta !== false,
          waitlist_position: nextPosition,
          lead_score: leadScore,
          status: 'pending',
          welcome_email_sent: false,
          ip_address: req.ip || req.connection.remoteAddress || null,
          user_agent: req.get('user-agent') || null,
          referral_code: ownReferralCode,
          referred_by_code: referrer ? referrer.referral_code : null,
          referral_count: 0,
          is_founding_member: false,
        },
      });

      if (referrer) {
        await tx.waitlist_users.update({
          where: { id: referrer.id },
          data: { referral_count: { increment: 1 } },
        });
      }

      return newUser;
    });

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(work_email, {
        full_name,
        waitlist_position: result.waitlist_position,
      });

      // Update the welcome_email_sent flag
      await prisma.waitlist_users.update({
        where: { id: result.id },
        data: { welcome_email_sent: true },
      });
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
      // Don't fail the request if email fails, but log it
    }

    return res.status(201).json({
      success: true,
      message: 'Successfully joined the waitlist!',
      data: {
        id: result.id,
        waitlist_position: result.waitlist_position,
        lead_score: result.lead_score,
        email: result.work_email,
        referral_code: result.referral_code,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Checks whether a referral code exists — used by the frontend to give
// instant "this code doesn't exist" feedback in Step 1, before the person
// even submits the form.
//
// Layered to keep this cheap even under heavy or abusive traffic:
//   1. Format check first — garbage input never touches the cache or DB.
//   2. In-memory cache second — repeat checks of the same code (common,
//      since many people will be checking the same shared/influencer code)
//      barely touch the DB at all.
//   3. Dedicated rate limiter on the route (see waitlistRoute.js) caps how
//      often any single IP can hit this endpoint at all.
exports.checkReferralCode = async (req, res) => {
  try {
    const code = normalizeReferralCode(req.params.code);

    if (!code || !/^[A-Z0-9-]{4,20}$/.test(code)) {
      return res.status(200).json({ success: true, exists: false });
    }

    const cached = getCached(code);
    if (cached !== undefined) {
      return res.status(200).json({ success: true, exists: cached });
    }

    const found = await prisma.waitlist_users.findUnique({
      where: { referral_code: code },
      select: { id: true },
    });

    const exists = !!found;
    setCached(code, exists);

    return res.status(200).json({ success: true, exists });
  } catch (error) {
    console.error('Referral check error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to check referral code',
    });
  }
};

// Step 2 fills in the remaining profile fields on a row already created
// by joinWaitlist. Every field is optional; only whatever was actually sent
// gets written. Re-scores the lead once the fuller picture is in.
exports.updateWaitlistDetails = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.waitlist_users.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Waitlist entry not found',
      });
    }

    const {
      tiktok_handle,
      instagram_handle,
      website_url,
      industry,
      country,
      state_region,
      team_size,
      monthly_revenue_range,
      monthly_order_volume,
      ecommerce_platform,
      email_platform,
      analytics_platform,
      support_platform,
      ad_platform,
      primary_goal,
      biggest_challenge,
      why_join_waitlist,
      current_churn_problem,
      abandoned_cart_problem,
      retention_problem,
      revenue_visibility_problem,
      interested_in_beta,
    } = req.body;

    // Only include fields the client actually sent, so a partial step-2
    // submission never blanks out something already on the row.
    const data = {};
    if (tiktok_handle !== undefined) data.tiktok_handle = tiktok_handle || null;
    if (instagram_handle !== undefined) data.instagram_handle = instagram_handle || null;
    if (website_url !== undefined) data.website_url = website_url || null;
    if (industry !== undefined) data.industry = industry || '';
    if (country !== undefined) data.country = country || '';
    if (state_region !== undefined) data.state_region = state_region || null;
    if (team_size !== undefined) data.team_size = team_size || null;
    if (monthly_revenue_range !== undefined) data.monthly_revenue_range = monthly_revenue_range || null;
    if (monthly_order_volume !== undefined) data.monthly_order_volume = monthly_order_volume || null;
    if (ecommerce_platform !== undefined) data.ecommerce_platform = ecommerce_platform || null;
    if (email_platform !== undefined) data.email_platform = email_platform || null;
    if (analytics_platform !== undefined) data.analytics_platform = analytics_platform || null;
    if (support_platform !== undefined) data.support_platform = support_platform || null;
    if (ad_platform !== undefined) data.ad_platform = ad_platform || null;
    if (primary_goal !== undefined) data.primary_goal = primary_goal || null;
    if (biggest_challenge !== undefined) data.biggest_challenge = biggest_challenge || '';
    if (why_join_waitlist !== undefined) data.why_join_waitlist = why_join_waitlist || null;
    if (current_churn_problem !== undefined) data.current_churn_problem = Boolean(current_churn_problem);
    if (abandoned_cart_problem !== undefined) data.abandoned_cart_problem = Boolean(abandoned_cart_problem);
    if (retention_problem !== undefined) data.retention_problem = Boolean(retention_problem);
    if (revenue_visibility_problem !== undefined) data.revenue_visibility_problem = Boolean(revenue_visibility_problem);
    if (interested_in_beta !== undefined) data.interested_in_beta = Boolean(interested_in_beta);

    // Re-score using the merged picture (existing row + whatever's new).
    const merged = { ...existing, ...data };
    data.lead_score = calculateLeadScore(merged);

    const updated = await prisma.waitlist_users.update({
      where: { id },
      data,
    });

    return res.status(200).json({
      success: true,
      message: 'Thanks — your profile is complete!',
      data: {
        id: updated.id,
        lead_score: updated.lead_score,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.getWaitlistStats = async (req, res, next) => {
  try {
    const stats = await prisma.waitlist_users.aggregate({
      _count: true,
      _avg: { lead_score: true },
    });

    const topLeads = await prisma.waitlist_users.findMany({
      where: { status: 'pending' },
      orderBy: { lead_score: 'desc' },
      take: 10,
      select: {
        id: true,
        full_name: true,
        company_name: true,
        lead_score: true,
        waitlist_position: true,
        referral_count: true,
        is_founding_member: true,
      },
    });

    return res.status(200).json({
      success: true,
      data: {
        total_waitlist_count: stats._count,
        average_lead_score: Math.round(stats._avg.lead_score || 0),
        top_leads: topLeads,
      },
    });
  } catch (error) {
    next(error);
  }
};