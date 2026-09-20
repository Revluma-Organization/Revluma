const dbConfig = require("../configs/database");
const prisma = dbConfig.prisma;
const cloudinary = require("../configs/cloudinary");


// GET CURRENT WORKSPACE
exports.getCurrentWorkspace = async (req, res, next) => {
  try {
    const organizationId = req.orgMembership?.organizationId;

    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: "Organization context required.",
      });
    }

    const organization = await prisma.organizations.findUnique({
      where: {
        id: organizationId,
      },
      select: {
        company_name: true,
        slug: true,
        industry: true,
        logo_url: true,
      },
    });

    if (!organization) {
      return res.status(404).json({
        success: false,
        message: "Organization not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        name: organization.company_name,
        slug: organization.slug,
        industry: organization.industry,
        logo_url: organization.logo_url,
      },
    });
  } catch (error) {
    next(error);
  }
};


// UPDATE CURRENT WORKSPACE

exports.updateCurrentWorkspace = async (req, res, next) => {
  try {
    const organizationId = req.orgMembership?.organizationId;
    const { name, slug, industry } = req.body;

    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: "Organization context required.",
      });
    }

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        message: "Organization name is required.",
      });
    }

    if (!slug || typeof slug !== "string") {
      return res.status(400).json({
        success: false,
        message: "Organization slug is required.",
      });
    }

    if (!industry || typeof industry !== "string") {
      return res.status(400).json({
        success: false,
        message: "Industry is required.",
      });
    }

    const normalizedName = name.trim();
    const normalizedSlug = slug.trim().toLowerCase();
    const normalizedIndustry = industry.trim();

    if (!normalizedName || !normalizedSlug || !normalizedIndustry) {
      return res.status(400).json({
        success: false,
        message: "Name, slug, and industry cannot be empty.",
      });
    }

    // Check whether another organization already owns this slug.
    const existingOrganization = await prisma.organizations.findFirst({
      where: {
        slug: normalizedSlug,
        NOT: {
          id: organizationId,
        },
      },
      select: {
        id: true,
      },
    });

    if (existingOrganization) {
      return res.status(409).json({
        success: false,
        message: "This organization slug is already in use.",
      });
    }

    const organization = await prisma.organizations.update({
      where: {
        id: organizationId,
      },
      data: {
        company_name: normalizedName,
        slug: normalizedSlug,
        industry: normalizedIndustry,
        updated_at: new Date(),
      },
      select: {
        company_name: true,
        slug: true,
        industry: true,
        logo_url: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Organization updated successfully.",
      data: {
        name: organization.company_name,
        slug: organization.slug,
        industry: organization.industry,
        logo_url: organization.logo_url,
      },
    });
  } catch (error) {
    next(error);
  }
};


// UPLOAD WORKSPACE LOGO
exports.uploadWorkspaceLogo = async (req, res, next) => {
  try {
    const organizationId = req.orgMembership?.organizationId;

    if (!organizationId) {
      return res.status(403).json({
        success: false,
        message: "Organization context required.",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Logo file is required.",
      });
    }

    const uploadToCloudinary = () => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: "revluma/organization-logos",
            resource_type: "image",
          },
          (error, result) => {
            if (error) {
              return reject(error);
            }

            resolve(result);
          }
        );

        uploadStream.end(req.file.buffer);
      });
    };

    const result = await uploadToCloudinary();

    const organization = await prisma.organizations.update({
      where: {
        id: organizationId,
      },
      data: {
        logo_url: result.secure_url,
        updated_at: new Date(),
      },
      select: {
        company_name: true,
        slug: true,
        industry: true,
        logo_url: true,
      },
    });

    return res.status(200).json({
      success: true,
      message: "Organization logo updated successfully.",
      data: {
        name: organization.company_name,
        slug: organization.slug,
        industry: organization.industry,
        logo_url: organization.logo_url,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.transferWorkspace = async (req, res, next) => {
  try {
    const { organizationId, role } = req.orgMembership || {};
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (role !== 'owner') return res.status(403).json({ success: false, error: 'Only the workspace owner can transfer ownership.' });
    if (!email) return res.status(400).json({ success: false, error: 'Email is required.' });

    const target = await prisma.users.findUnique({ where: { email }, select: { id: true, email: true, full_name: true } });
    if (!target) return res.status(404).json({ success: false, error: 'The target user must have a Revluma account.' });
    const targetMembership = await prisma.organization_members.findUnique({
      where: { organization_id_user_id: { organization_id: organizationId, user_id: target.id } },
    });
    if (!targetMembership || targetMembership.status !== 'active') {
      return res.status(400).json({ success: false, error: 'The target user must be an active workspace member.' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.organizations.update({ where: { id: organizationId }, data: { owner_id: target.id, updated_at: new Date() } });
      await tx.organization_members.update({ where: { id: req.orgMembership.membershipId }, data: { role: 'admin', updated_at: new Date() } });
      await tx.organization_members.update({ where: { id: targetMembership.id }, data: { role: 'owner', updated_at: new Date() } });
    });
    return res.status(200).json({ success: true, message: 'Workspace ownership transferred.', data: { owner: target } });
  } catch (error) {
    next(error);
  }
};

exports.archiveWorkspace = async (req, res, next) => {
  try {
    const { organizationId, role } = req.orgMembership || {};
    if (role !== 'owner') return res.status(403).json({ success: false, error: 'Only the workspace owner can archive the workspace.' });
    if (req.body?.confirmation !== 'DELETE') return res.status(400).json({ success: false, error: 'Type DELETE to confirm workspace archival.' });

    await prisma.$transaction(async (tx) => {
      await tx.organizations.update({ where: { id: organizationId }, data: { status: 'archived', archived_at: new Date(), updated_at: new Date() } });
      await tx.organization_members.updateMany({ where: { organization_id: organizationId, status: 'active' }, data: { status: 'archived', updated_at: new Date() } });
      await tx.stores.updateMany({ where: { organization_id: organizationId }, data: { status: 'inactive', updated_at: new Date() } });
      const members = await tx.organization_members.findMany({ where: { organization_id: organizationId }, select: { user_id: true } });
      await tx.refresh_tokens.deleteMany({ where: { user_id: { in: members.map((member) => member.user_id) } } });
    });
    return res.status(200).json({ success: true, message: 'Workspace archived successfully.' });
  } catch (error) {
    next(error);
  }
};