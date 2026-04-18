// ============================================================
// IDENTITY RESOLUTION ENGINE
// ============================================================
// Unifies customer identity across anonymous sessions, email
// addresses, device fingerprints, and platform IDs.
//
// Key features:
// - Cookie-based tracking (via script)
// - Email capture correlation
// - Checkout linkage
// - Heuristic merging rules
// - Unified customer profile

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const db = require('../config/db');
const logger = require('../utils/logger');

// ============================================================
// CORE IDENTITY TYPES
// ============================================================

const IDENTITY_TYPES = {
  ANONYMOUS_COOKIE: 'anonymous_cookie',
  EMAIL: 'email',
  PHONE: 'phone',
  DEVICE_FINGERPRINT: 'device_fingerprint',
  SHOPIFY_CUSTOMER_ID: 'shopify_customer_id',
  KLAVIYO_PROFILE_ID: 'klaviyo_profile_id'
};

const CUSTOMER_STATES = {
  UNKNOWN: 'unknown',
  IDENTIFIED: 'identified',
  VERIFIED: 'verified',
  CHURNED: 'churned'
};

// ============================================================
// IDENTITY GRAPH (In-memory + persistence)
// ============================================================

class IdentityGraph {
  constructor() {
    this.cache = new Map();
    this.expiryMs = 5 * 60 * 1000; // 5 min cache TTL
  }

  // Generate anonymous cookie ID
  generateAnonymousId() {
    return `anon_${uuidv4()}`;
  }

  // Generate device fingerprint hash
  generateDeviceFingerprint(userAgent, screenWidth, screenHeight, timezone, language) {
    const data = `${userAgent}|${screenWidth}|${screenHeight}|${timezone}|${language}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
  }

  // Resolve canonical customer ID from any identity
  async resolveCanonicalId(identityType, identityValue, tenantId) {
    if (!identityValue) return null;

    const cacheKey = `${tenantId}:${identityType}:${identityValue}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.expiryMs) {
      return cached.customerId;
    }

    try {
      // Look up in database
      const result = await db.query(
        `SELECT customer_id 
         FROM customer_identities 
         WHERE tenant_id = $1 AND identity_type = $2 AND identity_value = $3
         ORDER BY confidence DESC, created_at DESC
         LIMIT 1`,
        [tenantId, identityType, identityValue],
        tenantId
      );

      if (result.rowCount > 0) {
        const customerId = result.rows[0].customer_id;
        this.cache.set(cacheKey, { customerId, timestamp: Date.now() });
        return customerId;
      }

      return null;
    } catch (error) {
      logger.error('Identity resolution failed', { identityType, identityValue, tenantId, error: error.message });
      return null;
    }
  }

  // Link identities together
  async linkIdentities(tenantId, primaryCustomerId, secondaryIdentities) {
    const links = [];

    for (const { identityType, identityValue, confidence } of secondaryIdentities) {
      try {
        await db.query(
          `INSERT INTO customer_identities 
           (tenant_id, customer_id, identity_type, identity_value, confidence, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (tenant_id, identity_type, identity_value) 
           DO UPDATE SET customer_id = $2, confidence = GREATEST(customer_identities.confidence, $5)`,
          [tenantId, primaryCustomerId, identityType, identityValue, confidence || 0.5],
          tenantId
        );

        links.push({ identityType, identityValue, status: 'linked' });
      } catch (error) {
        logger.error('Identity link failed', { tenantId, primaryCustomerId, identityType, error: error.message });
        links.push({ identityType, identityValue, status: 'failed', error: error.message });
      }
    }

    return links;
  }

  // Merge two customer profiles
  async mergeCustomers(tenantId, sourceCustomerId, targetCustomerId) {
    // Transfer all identities to target
    await db.query(
      `UPDATE customer_identities 
       SET customer_id = $1 
       WHERE tenant_id = $2 AND customer_id = $3`,
      [targetCustomerId, tenantId, sourceCustomerId],
      tenantId
    );

    // Transfer behavioral data (sessions, events)
    await db.query(
      `UPDATE customer_events 
       SET customer_id = $1 
       WHERE tenant_id = $2 AND customer_id = $3`,
      [targetCustomerId, tenantId, sourceCustomerId],
      tenantId
    );

    // Mark source as merged
    await db.query(
      `UPDATE customers 
       SET status = 'merged', merged_into = $1 
       WHERE id = $2 AND tenant_id = $3`,
      [targetCustomerId, sourceCustomerId, tenantId],
      tenantId
    );

    // Clear cache
    this.cache.clear();

    logger.info('Customer merge completed', { tenantId, sourceCustomerId, targetCustomerId });
  }
}

// ============================================================
// IDENTITY RESOLUTION SERVICE
// ============================================================

class IdentityResolutionService {
  constructor() {
    this.graph = new IdentityGraph();
  }

  // Resolve from anonymous cookie to known identity
  async resolveFromCookie(tenantId, anonymousId) {
    return this.graph.resolveCanonicalId(IDENTITY_TYPES.ANONYMOUS_COOKIE, anonymousId, tenantId);
  }

  // Resolve from email
  async resolveFromEmail(tenantId, email) {
    if (!email) return null;
    return this.graph.resolveCanonicalId(IDENTITY_TYPES.EMAIL, email.toLowerCase(), tenantId);
  }

  // Resolve from phone
  async resolveFromPhone(tenantId, phone) {
    if (!phone) return null;
    const normalized = phone.replace(/\D/g, ''); // E.164 format
    return this.graph.resolveCanonicalId(IDENTITY_TYPES.PHONE, normalized, tenantId);
  }

  // Resolve from device fingerprint
  async resolveFromDeviceFingerprint(tenantId, fingerprint) {
    if (!fingerprint) return null;
    return this.graph.resolveCanonicalId(IDENTITY_TYPES.DEVICE_FINGERPRINT, fingerprint, tenantId);
  }

  // Resolve from Shopify customer ID
  async resolveFromShopifyId(tenantId, shopifyCustomerId) {
    if (!shopifyCustomerId) return null;
    return this.graph.resolveCanonicalId(IDENTITY_TYPES.SHOPIFY_CUSTOMER_ID, shopifyCustomerId, tenantId);
  }

  // Main resolution function - accepts multiple identifiers
  async resolve(tenantId, identifiers) {
    const { anonymousId, email, phone, deviceFingerprint, shopifyCustomerId, klaviyoProfileId } = identifiers;

    // Try each identifier in priority order
    let customerId = null;

    if (shopifyCustomerId) {
      customerId = await this.resolveFromShopifyId(tenantId, shopifyCustomerId);
      if (customerId) return { customerId, resolutionMethod: 'shopify_id' };
    }

    if (email) {
      customerId = await this.resolveFromEmail(tenantId, email);
      if (customerId) return { customerId, resolutionMethod: 'email' };
    }

    if (phone) {
      customerId = await this.resolveFromPhone(tenantId, phone);
      if (customerId) return { customerId, resolutionMethod: 'phone' };
    }

    if (deviceFingerprint) {
      customerId = await this.resolveFromDeviceFingerprint(tenantId, deviceFingerprint);
      if (customerId) return { customerId, resolutionMethod: 'device_fingerprint' };
    }

    if (anonymousId) {
      customerId = await this.resolveFromCookie(tenantId, anonymousId);
      if (customerId) return { customerId, resolutionMethod: 'anonymous_cookie' };
    }

    // If no existing customer found, create new
    return null;
  }

  // Identify anonymous session - create or update customer
  async identify(tenantId, identifiers) {
    const existing = await this.resolve(tenantId, identifiers);

    if (existing) {
      // Link new identities if found via different channels
      const newIdentities = [];
      if (identifiers.email && !identifiers.shopifyCustomerId) {
        newIdentities.push({ identityType: IDENTITY_TYPES.EMAIL, identityValue: identifiers.email.toLowerCase(), confidence: 0.9 });
      }
      if (identifiers.phone) {
        newIdentities.push({ identityType: IDENTITY_TYPES.PHONE, identityValue: identifiers.phone.replace(/\D/g, ''), confidence: 0.8 });
      }
      if (identifiers.deviceFingerprint) {
        newIdentities.push({ identityType: IDENTITY_TYPES.DEVICE_FINGERPRINT, identityValue: identifiers.deviceFingerprint, confidence: 0.6 });
      }
      if (identifiers.anonymousId) {
        newIdentities.push({ identityType: IDENTITY_TYPES.ANONYMOUS_COOKIE, identityValue: identifiers.anonymousId, confidence: 0.7 });
      }

      if (newIdentities.length > 0) {
        await this.graph.linkIdentities(tenantId, existing.customerId, newIdentities);
      }

      return { customerId: existing.customerId, isNew: false, resolutionMethod: existing.resolutionMethod };
    }

    // Create new customer
    const customerId = await this.createCustomer(tenantId, identifiers);
    return { customerId, isNew: true, resolutionMethod: 'created' };
  }

  // Create new customer with initial identity
  async createCustomer(tenantId, identifiers) {
    const customerId = uuidv4();

    // Insert customer
    await db.query(
      `INSERT INTO customers (id, tenant_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [customerId, tenantId, CUSTOMER_STATES.UNKNOWN],
      tenantId
    );

    // Insert primary identity
    const identities = [];
    if (identifiers.email) {
      identities.push({ type: IDENTITY_TYPES.EMAIL, value: identifiers.email.toLowerCase(), confidence: 1.0 });
    }
    if (identifiers.phone) {
      identities.push({ type: IDENTITY_TYPES.PHONE, value: identifiers.phone.replace(/\D/g, ''), confidence: 0.9 });
    }
    if (identifiers.shopifyCustomerId) {
      identities.push({ type: IDENTITY_TYPES.SHOPIFY_CUSTOMER_ID, value: identifiers.shopifyCustomerId, confidence: 1.0 });
    }
    if (identifiers.anonymousId) {
      identities.push({ type: IDENTITY_TYPES.ANONYMOUS_COOKIE, value: identifiers.anonymousId, confidence: 0.8 });
    }
    if (identifiers.deviceFingerprint) {
      identities.push({ type: IDENTITY_TYPES.DEVICE_FINGERPRINT, value: identifiers.deviceFingerprint, confidence: 0.6 });
    }

    for (const { type, value, confidence } of identities) {
      await db.query(
        `INSERT INTO customer_identities (tenant_id, customer_id, identity_type, identity_value, confidence, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [tenantId, customerId, type, value, confidence],
        tenantId
      );
    }

    logger.info('New customer created', { tenantId, customerId, identifiers: Object.keys(identifiers) });
    return customerId;
  }

  // Update customer state
  async updateCustomerState(tenantId, customerId, state, metadata = {}) {
    await db.query(
      `UPDATE customers 
       SET status = $1, updated_at = NOW() ${Object.keys(metadata).length > 0 ? `, metadata = $2` : ''}
       WHERE id = $3 AND tenant_id = $4`,
      metadata.length > 0 ? [state, JSON.stringify(metadata), customerId, tenantId] : [state, customerId, tenantId],
      tenantId
    );
  }

  // Get unified customer profile
  async getCustomerProfile(tenantId, customerId) {
    const customerResult = await db.query(
      `SELECT * FROM customers WHERE id = $1 AND tenant_id = $2`,
      [customerId, tenantId],
      tenantId
    );

    if (customerResult.rowCount === 0) return null;

    const customer = customerResult.rows[0];

    // Get all identities
    const identitiesResult = await db.query(
      `SELECT * FROM customer_identities WHERE customer_id = $1 AND tenant_id = $2`,
      [customerId, tenantId],
      tenantId
    );

    // Get recent events
    const eventsResult = await db.query(
      `SELECT * FROM customer_events 
       WHERE customer_id = $1 AND tenant_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [customerId, tenantId],
      tenantId
    );

    return {
      ...customer,
      identities: identitiesResult.rows,
      recentEvents: eventsResult.rows
    };
  }
}

// ============================================================
// TRACKING SCRIPT HELPERS (for client-side)
// ============================================================

function generateTrackingScript() {
  return `
    <!-- Revluma Tracking Script -->
    <script>
      (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
        var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='revlumaData'?'&l='+l:'';
        j.async=true;j.src='https://cdn.revluma.com/tracking.js?id='+i+dl;
        f.parentNode.insertBefore(j,f);
      })(window,document,'script','revlumaData','{{TRACKING_ID}}');
    </script>
    <!-- End Revluma Tracking Script -->
  `;
}

function generateAnonymousId() {
  let anonId = localStorage.getItem('revluma_anon_id');
  if (!anonId) {
    anonId = 'anon_' + 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
    localStorage.setItem('revluma_anon_id', anonId);
  }
  return anonId;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  IdentityResolutionService,
  IdentityGraph,
  IDENTITY_TYPES,
  CUSTOMER_STATES,
  generateTrackingScript,
  generateAnonymousId
};