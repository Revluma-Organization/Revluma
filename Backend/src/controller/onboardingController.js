/**
 * Onboarding answers (Frontend/auth/onboarding.html).
 *
 * Step 1 (store) and step 2 (goals) are each saved the moment the merchant
 * continues, so nothing is lost if they close the tab between steps.
 *
 * - Store details live on the organisation (company_name, store_url,
 *   industry, monthly_order_volume) because the rest of the product reads
 *   them from there.
 * - Goals are personal to the user: onboarding_profiles + onboarding_objectives.
 * - Progress is tracked on users.onboarding_step / onboarding_completed.
 *
 * Only allowlisted values are stored; the organisation always comes from the
 * authenticated membership, never from the request body.
 */
const { requireMembership } = require('../utils/organizationContext');
const logger = require('../utils/logger');
const dbConfig = require('../configs/database');

const prisma = dbConfig.prisma;

const STORE_CATEGORIES = Object.freeze([
  'fashion', 'beauty', 'electronics', 'home_living', 'health_wellness',
  'sports', 'food_beverage', 'pets', 'other_niche',
]);
const MONTHLY_ORDER_RANGES = Object.freeze(['under_100', '100_1000', '1000_10000', '10000_plus']);
const GOALS = Object.freeze(['sales_changes', 'product_attention', 'customer_behaviour', 'priorities']);
const EDITOR_ROLES = new Set(['owner', 'admin']);

const STEP_STORE_DONE = 2;
const STEP_COMPLETE = 3;

function fail(res, status, error, field) {
  return res.status(status).json({ success: false, error, ...(field ? { field } : {}) });
}

// Accepts "yourstore.myshopify.com", "https://shop.example.com/collections"
// and similar; stores a canonical "https://host" or returns null if invalid.
function normaliseStoreUrl(value) {
  if (typeof value !== 'string') return null;
  const host = value.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.$/, '');
  if (!host || host.length > 253) return null;
  const labels = host.split('.');
  if (labels.length < 2) return null;
  const labelOk = (label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label);
  if (!labels.every(labelOk)) return null;
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1])) return null;
  return `https://${host}`;
}

function normaliseStoreName(value) {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 120) return null;
  // No markup or control characters in a value shown across the product.
  if (/[<>\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

async function editableOrganisation(req) {
  const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
  if (!EDITOR_ROLES.has(membership.role)) {
    throw Object.assign(new Error('Only the workspace owner or an admin can complete setup.'), { statusCode: 403 });
  }
  return membership.organization_id;
}

function serialise(user, organisation, goals) {
  // Before step 1 is saved the organisation only holds signup placeholders,
  // which must not be shown back to the merchant as their own answers.
  if ((user?.onboarding_step || 1) < STEP_STORE_DONE && user?.onboarding_completed !== true) organisation = null;
  return {
    step: user?.onboarding_step || 1,
    completed: user?.onboarding_completed === true,
    store: {
      name: organisation?.company_name || '',
      url: organisation?.store_url || '',
      category: STORE_CATEGORIES.includes(organisation?.industry) ? organisation.industry : '',
      monthly_orders: MONTHLY_ORDER_RANGES.includes(organisation?.monthly_order_volume) ? organisation.monthly_order_volume : '',
    },
    goals: (goals || []).filter((goal) => GOALS.includes(goal)),
  };
}

// GET /api/v1/onboarding: saved answers, so the page can resume where the merchant left off.
exports.getOnboarding = async (req, res, next) => {
  try {
    const membership = await requireMembership(prisma, req.user.id, req.user.tenantId);
    const [user, organisation, profile] = await Promise.all([
      prisma.users.findUnique({ where: { id: req.user.id }, select: { onboarding_step: true, onboarding_completed: true } }),
      prisma.organizations.findUnique({
        where: { id: membership.organization_id },
        select: { company_name: true, store_url: true, industry: true, monthly_order_volume: true },
      }),
      prisma.onboarding_profiles.findUnique({
        where: { user_id: req.user.id },
        select: { onboarding_objectives: { select: { objective: true }, orderBy: { created_at: 'asc' } } },
      }),
    ]);
    const goals = profile?.onboarding_objectives?.map((row) => row.objective) || [];
    return res.status(200).json({ success: true, data: serialise(user, organisation, goals) });
  } catch (error) {
    if (error.statusCode) return fail(res, error.statusCode, error.message);
    return next(error);
  }
};

// PUT /api/v1/onboarding/store: step 1.
exports.saveStore = async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = normaliseStoreName(body.store_name);
    if (!name) return fail(res, 400, 'Enter your store name (up to 120 characters).', 'store_name');
    const storeUrl = normaliseStoreUrl(body.store_url);
    if (!storeUrl) return fail(res, 400, 'Enter a valid store address, like yourstore.myshopify.com.', 'store_url');
    if (!STORE_CATEGORIES.includes(body.store_category)) return fail(res, 400, 'Choose a store category.', 'store_category');
    if (!MONTHLY_ORDER_RANGES.includes(body.monthly_orders)) return fail(res, 400, 'Choose your monthly orders.', 'monthly_orders');

    const organisationId = await editableOrganisation(req);
    const now = new Date();
    const [organisation, user] = await prisma.$transaction(async (tx) => {
      const updatedOrganisation = await tx.organizations.update({
        where: { id: organisationId },
        data: {
          company_name: name,
          store_url: storeUrl,
          website_url: storeUrl,
          industry: body.store_category,
          custom_industry: null,
          monthly_order_volume: body.monthly_orders,
          updated_at: now,
        },
        select: { company_name: true, store_url: true, industry: true, monthly_order_volume: true },
      });
      const current = await tx.users.findUnique({ where: { id: req.user.id }, select: { onboarding_step: true, onboarding_completed: true } });
      const updatedUser = await tx.users.update({
        where: { id: req.user.id },
        data: { onboarding_step: Math.max(current?.onboarding_step || 1, STEP_STORE_DONE), updated_at: now },
        select: { onboarding_step: true, onboarding_completed: true },
      });
      return [updatedOrganisation, updatedUser];
    });

    logger.info('onboarding_store_saved', { userId: req.user.id, organisationId });
    return res.status(200).json({ success: true, data: serialise(user, organisation, []) });
  } catch (error) {
    if (error.statusCode) return fail(res, error.statusCode, error.message);
    return next(error);
  }
};

// PUT /api/v1/onboarding/goals: step 2, which completes onboarding.
exports.saveGoals = async (req, res, next) => {
  try {
    const raw = req.body?.goals;
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > GOALS.length) {
      return fail(res, 400, 'Choose at least one goal.', 'goals');
    }
    if (!raw.every((goal) => GOALS.includes(goal))) return fail(res, 400, 'One of the goals is not recognised.', 'goals');
    const goals = [...new Set(raw)];

    const organisationId = await editableOrganisation(req);
    const now = new Date();
    const user = await prisma.$transaction(async (tx) => {
      const profile = await tx.onboarding_profiles.upsert({
        where: { user_id: req.user.id },
        create: { user_id: req.user.id },
        update: { updated_at: now },
        select: { id: true },
      });
      await tx.onboarding_objectives.deleteMany({ where: { onboarding_profile_id: profile.id } });
      await tx.onboarding_objectives.createMany({
        data: goals.map((objective) => ({ onboarding_profile_id: profile.id, objective })),
      });
      return tx.users.update({
        where: { id: req.user.id },
        data: { onboarding_completed: true, onboarding_step: STEP_COMPLETE, updated_at: now },
        select: { onboarding_step: true, onboarding_completed: true },
      });
    });

    logger.info('onboarding_completed', { userId: req.user.id, organisationId, goals: goals.length });
    return res.status(200).json({ success: true, data: { step: user.onboarding_step, completed: user.onboarding_completed === true, goals } });
  } catch (error) {
    if (error.statusCode) return fail(res, error.statusCode, error.message);
    return next(error);
  }
};

exports.STORE_CATEGORIES = STORE_CATEGORIES;
exports.MONTHLY_ORDER_RANGES = MONTHLY_ORDER_RANGES;
exports.GOALS = GOALS;
exports.normaliseStoreUrl = normaliseStoreUrl;
exports.normaliseStoreName = normaliseStoreName;
