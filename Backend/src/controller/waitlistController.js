const { validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const dbConfig = require('../configs/database');
const emailService = require('../utils/emailService');

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

exports.joinWaitlist = async (req, res, next) => {
  try {
    // Honeypot — bots tend to fill every field they can find; real users never
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

    // Get the current highest waitlist position
    const lastWaitlistUser = await prisma.waitlist_users.findFirst({
      orderBy: { waitlist_position: 'desc' },
    });

    const nextPosition = (lastWaitlistUser?.waitlist_position || 0) + 1;

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

    // Create the waitlist record
    const waitlistUser = await prisma.waitlist_users.create({
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
        industry,
        country,
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
        biggest_challenge,
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
      },
    });

    // Send welcome email
    try {
      await emailService.sendWelcomeEmail(work_email, {
        full_name,
        waitlist_position: nextPosition,
      });

      // Update the welcome_email_sent flag
      await prisma.waitlist_users.update({
        where: { id: waitlistUser.id },
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
        id: waitlistUser.id,
        waitlist_position: waitlistUser.waitlist_position,
        lead_score: waitlistUser.lead_score,
        email: waitlistUser.work_email,
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