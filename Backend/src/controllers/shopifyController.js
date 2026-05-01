const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const logger = require('../utils/logger');
const { encrypt } = require('../integration/encryption');

const prisma = new PrismaClient();

const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const APP_URL = process.env.APP_URL || (process.env.NODE_ENV === 'production' ? 'https://revluma.onrender.com' : 'http://localhost:5000');

const SCOPES = 'read_products,read_orders,read_customers,read_checkouts,read_all_orders';

exports.initiateAuth = async (req, res) => {
  try {
    const { shop } = req.body;
    const authHeader = req.headers.authorization;

    if (!shop) {
      return res.status(400).json({ error: 'Missing shop parameter' });
    }

    // Get tenant from token
    let tenantId = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        tenantId = decoded.tenant_id;
      } catch (e) { }
    }

    if (!tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const redirectUri = `${APP_URL}/api/shopify/auth/callback?tenant_id=${tenantId}`;
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPES}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    logger.info('Initiating Shopify OAuth', { shop, tenantId });

    res.json({ authUrl: installUrl });
  } catch (error) {
    logger.error('Failed to initiate OAuth', { error: error.message });
    res.status(500).json({ error: 'Failed to initiate OAuth flow' });
  }
};

exports.authCallback = async (req, res) => {
  const { shop, hmac, code, tenant_id } = req.query;

  if (!shop || !hmac || !code) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const map = { ...req.query };
  delete map['hmac'];
  const message = new URLSearchParams(map).toString();
  const providedHmac = Buffer.from(hmac, 'utf-8');
  const generatedHmac = Buffer.from(
    crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex'),
    'utf-8'
  );

  if (!crypto.timingSafeEqual(providedHmac, generatedHmac)) {
    logger.warn('HMAC validation failed', { shop });
    return res.status(400).json({ error: 'HMAC validation failed' });
  }

  let tenantId = tenant_id;

  if (!tenantId) {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const jwt = require('jsonwebtoken');
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
        tenantId = decoded.tenant_id;
      } catch (e) { }
    }
  }

  if (!tenantId) {
    return res.redirect(`${APP_URL}/dashboard/overview?error=no_tenant`);
  }

  try {
    const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SHOPIFY_API_KEY,
        client_secret: SHOPIFY_API_SECRET,
        code,
      }),
    });

    const data = await response.json();
    const accessToken = data.access_token;

    if (!accessToken) {
      logger.error('Failed to get access token', { shop, data });
      return res.redirect(`${APP_URL}/dashboard/overview?error=connection_failed`);
    }

    const shopResponse = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': accessToken },
    });
    const shopData = await shopResponse.json();
    const storeName = shopData.shop?.name || shop;
    const storeUrl = `https://${shop}`;

    const credentials = {
      shopDomain: shop,
      accessToken,
    };

    const credentialsJson = JSON.stringify(credentials);
    const credentialsEncrypted = encrypt(credentialsJson);

    const storeConfig = await prisma.storeConfig.upsert({
      where: {
        tenantId_platform_storeUrl: {
          tenantId,
          platform: 'SHOPIFY',
          storeUrl,
        },
      },
      create: {
        tenantId,
        platform: 'SHOPIFY',
        storeName,
        storeUrl,
        credentialsEncrypted,
        status: 'connected',
        callbackUrl: APP_URL,
      },
      update: {
        storeName,
        credentialsEncrypted,
        status: 'connected',
      },
    });

    const iv = crypto.randomBytes(16).toString('hex');
    const authTag = crypto.randomBytes(16).toString('hex');

    await prisma.platformCredential.upsert({
      where: { storeId: storeConfig.id },
      create: {
        storeId: storeConfig.id,
        platform: 'SHOPIFY',
        encryptedPayload: credentialsEncrypted,
        iv,
        authTag,
        status: 'ACTIVE',
        lastVerifiedAt: new Date(),
      },
      update: {
        encryptedPayload: credentialsEncrypted,
        iv,
        authTag,
        status: 'ACTIVE',
        lastVerifiedAt: new Date(),
        failureReason: null,
      },
    });

    logger.info('Shopify store connected via OAuth', { shop, storeName, tenantId, storeId: storeConfig.id });

    res.redirect(`${APP_URL}/dashboard/overview?connected=shopify&storeId=${storeConfig.id}`);

  } catch (err) {
    logger.error('Shopify auth callback failed', { shop, error: err.message });
    res.redirect(`${APP_URL}/dashboard/overview?error=connection_failed`);
  }
};