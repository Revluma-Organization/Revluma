const prisma = require("../../configs/database").prisma;

exports.getStores = async (req, res, next) => {
  try {
    const org = await prisma.organizations.findFirst({
      where: { owner_id: req.user.id },
      select: { id: true },
    });

    if (!org) {
      return res.status(200).json({ success: true, data: { stores: [] } });
    }

    const stores = await prisma.stores.findMany({
      where: { organization_id: org.id },
      select: {
        id: true,
        platform: true,
        shop_domain: true,
        status: true,
        installed_at: true,
        last_synced_at: true,
      },
    });

    return res.status(200).json({ success: true, data: { stores } });
  } catch (error) {
    next(error);
  }
};
