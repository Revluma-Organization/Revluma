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

    const {
      primaryColor,
      accentColor
    } = req.body;


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