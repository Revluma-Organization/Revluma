const dbConfig = require("../configs/database");
const prisma = dbConfig.prisma;


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