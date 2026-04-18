const express = require('express');
const { createAdapter } = require('../integration');
const { encrypt } = require('../integration/encryption');
const logger = require('../utils/logger');

function createStoreRoutes(prisma) {
  const router = express.Router();

  router.post('/connect', async (req, res) => {
    try {
      const { tenantId, platform, credentials, callbackUrl } = req.body;

      if (!tenantId || !platform || !credentials) {
        return res.status(400).json({ 
          error: 'Missing required fields: tenantId, platform, credentials' 
        });
      }

      const adapter = createAdapter(platform, prisma);

      const result = await adapter.connect(credentials);

      if (!result.success) {
        return res.status(400).json({ 
          error: result.error || 'Connection failed' 
        });
      }

      const storeUrl = 
        credentials.shopDomain || 
        credentials.storeUrl || 
        `https://store-${credentials.storeHash}.mybigcommerce.com`;

      const credentialsJson = JSON.stringify(credentials);
      const credentialsEncrypted = encrypt(credentialsJson);

      const storeConfig = await prisma.storeConfig.upsert({
        where: {
          tenantId_platform_storeUrl: {
            tenantId,
            platform,
            storeUrl,
          },
        },
        create: {
          tenantId,
          platform,
          storeName: result.storeName || storeUrl,
          storeUrl,
          callbackUrl: callbackUrl || null,
          credentialsEncrypted,
          status: 'connected',
        },
        update: {
          storeName: result.storeName || storeUrl,
          callbackUrl: callbackUrl || undefined,
          credentialsEncrypted,
          status: 'connected',
        },
      });

      logger.info(`Store connected: ${platform} - ${storeUrl}`, { tenantId });

      return res.status(201).json({
        storeId: storeConfig.id,
        platform: storeConfig.platform,
        storeName: storeConfig.storeName,
        storeUrl: storeConfig.storeUrl,
        status: storeConfig.status,
      });

    } catch (error) {
      logger.error('Failed to connect store', { error: error.message });
      return res.status(500).json({ error: 'Failed to connect store' });
    }
  });

  router.post('/:storeId/disconnect', async (req, res) => {
    try {
      const { storeId } = req.params;

      const storeConfig = await prisma.storeConfig.findUnique({
        where: { id: storeId },
      });

      if (!storeConfig) {
        return res.status(404).json({ error: 'Store not found' });
      }

      const adapter = createAdapter(storeConfig.platform, prisma);
      await adapter.disconnect(storeId);

      await prisma.storeConfig.update({
        where: { id: storeId },
        data: { status: 'disconnected' },
      });

      logger.info(`Store disconnected: ${storeId}`);

      return res.status(200).json({ message: 'Store disconnected' });

    } catch (error) {
      logger.error('Failed to disconnect store', { error: error.message });
      return res.status(500).json({ error: 'Failed to disconnect store' });
    }
  });

  router.get('/:storeId/health', async (req, res) => {
    try {
      const { storeId } = req.params;

      const storeConfig = await prisma.storeConfig.findUnique({
        where: { id: storeId },
      });

      if (!storeConfig) {
        return res.status(404).json({ error: 'Store not found' });
      }

      const adapter = createAdapter(storeConfig.platform, prisma);
      const health = await adapter.healthCheck(storeId);

      const status = health.healthy ? 'connected' : 'unreachable';
      
      await prisma.storeConfig.update({
        where: { id: storeId },
        data: { status },
      });

      return res.status(200).json({
        storeId,
        platform: storeConfig.platform,
        status,
        latencyMs: health.latencyMs,
        error: health.error,
      });

    } catch (error) {
      logger.error('Failed to check health', { error: error.message });
      return res.status(500).json({ error: 'Failed to check health' });
    }
  });

  router.post('/:storeId/webhooks', async (req, res) => {
    try {
      const { storeId } = req.params;
      const { topics } = req.body;

      const storeConfig = await prisma.storeConfig.findUnique({
        where: { id: storeId },
      });

      if (!storeConfig) {
        return res.status(404).json({ error: 'Store not found' });
      }

      const adapter = createAdapter(storeConfig.platform, prisma);
      const registered = await adapter.registerWebhooks(storeId, topics);

      return res.status(200).json({
        storeId,
        registered,
      });

    } catch (error) {
      logger.error('Failed to register webhooks', { error: error.message });
      return res.status(500).json({ error: 'Failed to register webhooks' });
    }
  });

  router.get('/tenant/:tenantId', async (req, res) => {
    try {
      const { tenantId } = req.params;

      const stores = await prisma.storeConfig.findMany({
        where: { tenantId },
        select: {
          id: true,
          platform: true,
          storeName: true,
          storeUrl: true,
          status: true,
          cartTrackingMode: true,
          lastSyncAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({ stores });

    } catch (error) {
      logger.error('Failed to list stores', { error: error.message });
      return res.status(500).json({ error: 'Failed to list stores' });
    }
  });

  return router;
}

module.exports = { createStoreRoutes };