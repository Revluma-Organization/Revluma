const dbConfig = require("../configs/database");
const prisma = dbConfig.prisma;
const { DEFAULT_POLICY, normalizePolicy } = require('../services/recoveryActionService');


// GET BRANDING
exports.getBranding = async (req, res, next) => {
  try {
    const organizationId = req.user.tenantId;
    if (!organizationId) {
      return res.status(400).json({
        success:false,
        message:"Organization not found"
      });
    }


    const organization = await prisma.organizations.findUnique({
      where:{
        id: organizationId
      },
      select:{
        primary_color:true,
        accent_color:true,
        logo_url:true,
        favicon_url:true
      }
    });


    if(!organization){
      return res.status(404).json({
        success:false,
        message:"Organization not found"
      });
    }


    return res.status(200).json({
      primaryColor: organization.primary_color,
      accentColor: organization.accent_color,
      logoUrl: organization.logo_url,
      faviconUrl: organization.favicon_url
    });


  } catch(error){
    next(error);
  }
};


// UPDATE BRANDING
exports.updateBranding = async(req,res,next)=>{
  try{
    const organizationId = req.user.tenantId;
    const { primaryColor,accentColor} = req.body;

    const organization = await prisma.organizations.update({

      where:{
        id: organizationId
      },

      data:{
        primary_color: primaryColor,
        accent_color: accentColor
      },

      select:{
        primary_color:true,
        accent_color:true,
        logo_url:true,
        favicon_url:true
      }

    });

    return res.status(200).json({
      primaryColor: organization.primary_color,
      accentColor: organization.accent_color,
      logoUrl: organization.logo_url,
      faviconUrl: organization.favicon_url
    });

  }catch(error){
    next(error);
  }
};

const PREFERENCE_KEYS = [
  "security-alerts",
  "api-expiration",
  "new-team-members",
  "role-permission-updates",
  "invoice-receipts",
  "usage-limits",
  "weekly-reports",
  "cart-recovery-digest",
];

const validatePreferenceGroup = (group) => {
  if (!group || typeof group !== "object" || Array.isArray(group)) {
    return false;
  }

  return PREFERENCE_KEYS.every(
    (key) => typeof group[key] === "boolean"
  );
};

//UpdateNotificationPreferences
exports.updateNotificationPreferences = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const { emailPreferences, inAppPreferences } = req.body;

    if (
      !validatePreferenceGroup(emailPreferences) ||
      !validatePreferenceGroup(inAppPreferences)
    ) {
      return res.status(400).json({
        success: false,
        error: "Invalid notification preferences.",
      });
    }

    const notificationPreferences = {
      emailPreferences,
      inAppPreferences,
    };

    const user = await prisma.users.update({
      where: {
        id: userId,
      },
      data: {
        notification_preferences: notificationPreferences,
        updated_at: new Date(),
      },
      select: {
        notification_preferences: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Notification preferences updated successfully.",
      data: user.notification_preferences,
    });
  } catch (error) {
    next(error);
  }
};


//getNotificationPreferences
exports.getNotificationPreferences = async (req, res, next) => {
  try {
    const user = await prisma.users.findUnique({
      where: {
        id: req.user.id,
      },
      select: {
        notification_preferences: true,
      },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "User not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: user.notification_preferences,
    });
  } catch (error) {
    next(error);
  }
};

async function findOrganizationStore(req, res) {
  const store = await prisma.stores.findFirst({
    where: {
      id: req.params.storeId,
      organization_id: req.orgMembership.organizationId,
      status: { not: 'deleted' },
    },
    select: { id: true },
  });
  if (!store) {
    res.status(404).json({ success: false, error: 'Store not found.' });
    return null;
  }
  return store;
}

exports.getBetaAutomation = async (req, res, next) => {
  try {
    const store = await findOrganizationStore(req, res);
    if (!store) return;
    const row = await prisma.store_settings.findUnique({
      where: {
        store_id_settings_group: {
          store_id: store.id,
          settings_group: 'beta_automation',
        },
      },
    });
    return res.status(200).json({
      success: true,
      data: row ? normalizePolicy(row.settings) : { ...DEFAULT_POLICY },
    });
  } catch (error) {
    return next(error);
  }
};

exports.updateBetaAutomation = async (req, res, next) => {
  try {
    const store = await findOrganizationStore(req, res);
    if (!store) return;
    const allowedKeys = new Set([
      'enabled', 'allowed_actions', 'allowed_channels', 'max_discount_pct',
      'max_messages_per_customer_24h', 'max_actions_per_store_24h', 'kill_switch',
    ]);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
        Object.keys(req.body).some((key) => !allowedKeys.has(key))) {
      return res.status(400).json({ success: false, error: 'Invalid beta automation policy.' });
    }
    const policy = normalizePolicy(req.body);
    const allowedActions = new Set(['cart_recovery_message', 'percentage_discount']);
    if (policy.allowed_actions.some((action) => !allowedActions.has(action)) ||
        policy.allowed_channels.some((channel) => channel !== 'email')) {
      return res.status(400).json({ success: false, error: 'Unsupported beta action or channel.' });
    }
    if (policy.enabled && (
      policy.kill_switch ||
      !policy.allowed_actions.includes('cart_recovery_message') ||
      !policy.allowed_channels.includes('email') ||
      policy.max_messages_per_customer_24h < 1 ||
      policy.max_actions_per_store_24h < 1
    )) {
      return res.status(400).json({
        success: false,
        error: 'Enabled beta automation requires email recovery, positive limits, and kill_switch=false.',
      });
    }
    await prisma.store_settings.upsert({
      where: {
        store_id_settings_group: {
          store_id: store.id,
          settings_group: 'beta_automation',
        },
      },
      create: { store_id: store.id, settings_group: 'beta_automation', settings: policy },
      update: { settings: policy, updated_at: new Date() },
    });
    await prisma.audit_logs.create({
      data: {
        organization_id: req.orgMembership.organizationId,
        user_id: req.user.id,
        entity_type: 'store_settings',
        entity_id: store.id,
        action: 'beta_automation_policy_updated',
        context: policy,
      },
    });
    return res.status(200).json({ success: true, data: policy });
  } catch (error) {
    return next(error);
  }
};
