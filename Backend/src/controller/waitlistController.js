const crypto = require('crypto');
const dbConfig = require('../configs/database');
const { getCached, setCached } = require('../utils/referralCache');
const logger = require('../utils/logger');

const prisma = dbConfig.prisma;

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
    logger.error('referral_check_error', {
      error_type: error?.code || error?.name || 'referral_query_error',
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to check referral code',
    });
  }
};

exports.getWaitlistStats = async (req, res, next) => {
  try {
    const stats = await prisma.waitlist_users.aggregate({
      _count: true,
      _avg: { lead_score: true },
    });

    const topLeads = await prisma.waitlist_users.findMany({
      where: { status: 'submitted' },
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

// Shared with the Founding Merchants application (waitlistApplicationController),
// which issues an applicant's own share code when they submit.
exports.generateUniqueReferralCode = generateUniqueReferralCode;
exports.normalizeReferralCode = normalizeReferralCode;
