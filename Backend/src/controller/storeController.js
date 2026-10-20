const prisma = require("../configs/database").prisma;
const { REQUIRED_SUBSCRIPTIONS } = require('../services/shopifyWebhookService');

exports.getStores = async (req, res, next) => {
  try {
    const membership = await prisma.organization_members.findFirst({
      where: { user_id: req.user.id, status: 'active' },
      select: { organization_id: true },
      orderBy: { created_at: 'asc' },
    });

    const organization = membership
      ? null
      : await prisma.organizations.findFirst({
        where: { owner_id: req.user.id },
        select: { id: true },
      });
    const organizationId = membership?.organization_id || organization?.id;
    if (!organizationId) return res.status(200).json({ success: true, data: { stores: [] } });

    const stores = await prisma.stores.findMany({
      where: { organization_id: organizationId },
      select: {
        id: true,
        platform: true,
        shop_domain: true,
        status: true,
        access_token: true,
        installed_at: true,
        last_synced_at: true,
        updated_at: true,
      },
    });

    const shopifyStoreIds = stores
      .filter((store) => store.platform === 'shopify')
      .map((store) => store.id);
    const registrations = shopifyStoreIds.length
      ? await prisma.webhook_registrations.findMany({
        where: { store_id: { in: shopifyStoreIds } },
        select: { store_id: true, topic: true, status: true, external_id: true, last_error: true, attempt_count: true, started_at: true, completed_at: true },
      })
      : [];
    const topicsByStore = new Map();
    const webhookDetailsByStore = new Map();
    const statusPriority = { active: 1, failed: 2, running: 3, succeeded: 4 };
    for (const registration of registrations) {
      const details = webhookDetailsByStore.get(registration.store_id) || new Map();
      const current = details.get(registration.topic);
      const priority = statusPriority[registration.status] || 0;
      const currentPriority = current?.priority || 0;
      if (!current || priority >= currentPriority) {
        details.set(registration.topic, {
          topic: registration.topic,
          status: ['active', 'succeeded'].includes(registration.status) ? 'registered' : ['failed', 'running'].includes(registration.status) ? registration.status : 'unknown',
          error: registration.last_error || null,
          attempt_count: registration.attempt_count || 0,
          started_at: registration.started_at || null,
          completed_at: registration.completed_at || null,
          priority,
        });
      }
      webhookDetailsByStore.set(registration.store_id, details);
      if (registration.status === 'active') {
        const topics = topicsByStore.get(registration.store_id) || new Set();
        topics.add(registration.topic);
        topicsByStore.set(registration.store_id, topics);
      }
    }
    const requiredTopics = REQUIRED_SUBSCRIPTIONS.map(([topic]) => topic);

    const responseStores = stores.map((store) => {
      const connected = Boolean(store.access_token) && !['inactive', 'deleted'].includes(store.status);
      const registeredTopics = topicsByStore.get(store.id) || new Set();
      const webhookDetails = webhookDetailsByStore.get(store.id) || new Map();
      const webhooksReady = store.platform !== 'shopify' ||
        requiredTopics.every((topic) => registeredTopics.has(topic));
      const webhooksRunning = store.platform === 'shopify' && [...webhookDetails.values()].some((detail) => detail.status === 'running');
      const webhooksFailed = store.platform === 'shopify' && [...webhookDetails.values()].some((detail) => detail.status === 'failed');
      const syncStatus = store.status === 'syncing'
        ? store.updated_at && Date.now() - store.updated_at.getTime() >= 15 * 60 * 1000
          ? 'failed'
          : 'in_progress'
        : store.status === 'active' && !store.last_synced_at && store.updated_at &&
            Date.now() - store.updated_at.getTime() < 15 * 60 * 1000
          ? 'in_progress'
        : store.status === 'error'
          ? 'failed'
          : store.last_synced_at
            ? 'complete'
            : 'pending';
      const safeStore = { ...store };
      delete safeStore.access_token;

      return {
        ...safeStore,
        connection_status: connected ? 'connected' : 'disconnected',
        webhooks_registered: store.platform === 'shopify' ? registeredTopics.size : null,
        webhooks_required: store.platform === 'shopify' ? requiredTopics.length : null,
        webhook_details: store.platform === 'shopify' ? requiredTopics.map((topic) => {
          const detail = webhookDetailsByStore.get(store.id)?.get(topic);
          return detail ? { topic, status: detail.status, error: detail.error, attempt_count: detail.attempt_count, started_at: detail.started_at, completed_at: detail.completed_at } : { topic, status: 'not_attempted', error: null, attempt_count: 0, started_at: null, completed_at: null };
        }) : null,
        setup_status: !connected
          ? 'disconnected'
          : webhooksRunning || syncStatus === 'in_progress'
            ? 'in_progress'
            : webhooksFailed || syncStatus === 'failed'
              ? 'failed'
              : !webhooksReady
                ? 'webhooks_pending'
                : syncStatus,
      };
    });

    return res.status(200).json({ success: true, data: { stores: responseStores } });
  } catch (error) {
    next(error);
  }
};
