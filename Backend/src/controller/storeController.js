const prisma = require("../configs/database").prisma;

exports.getStores = async (req, res, next) => {
  try {
    const membership = await prisma.organization_members.findFirst({
      where: { user_id: req.user.id, status: 'active' },
      select: { organization_id: true },
      orderBy: { created_at: 'asc' },
    });

    if (!membership) {
      return res.status(200).json({ success: true, data: { stores: [] } });
    }

    const stores = await prisma.stores.findMany({
      where: { organization_id: membership.organization_id },
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
