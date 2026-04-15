const express = require('express');
const router = express.Router();
const authenticate = require('../../middleware/auth');
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

// ============================================================
// Customers API
// Customer data and segments
// ============================================================

// GET /api/v1/customers
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const { page = 1, limit = 20, segment = 'all' } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build where clause
    const where = { tenantId };
    if (segment === 'at-risk') {
      where.churnScore = { gte: 70 };
    } else if (segment === 'vip') {
      where.ltv = { gte: 500 };
    } else if (segment === 'new') {
      where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };
    }

    const [customers, total] = await Promise.all([
      prisma.customerCrm.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        select: {
          id: true,
          email: true,
          fullName: true,
          totalOrders: true,
          totalSpent: true,
          ltv: true,
          churnScore: true,
          lastOrderDate: true,
          createdAt: true
        }
      }),
      prisma.customerCrm.count({ where })
    ]);

    res.json({
      success: true,
      data: customers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    logger.error('Customers fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// GET /api/v1/customers/segments
router.get('/segments', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;

    const [total, atRisk, vip, newCustomers, inactive] = await Promise.all([
      prisma.customerCrm.count({ where: { tenantId } }),
      prisma.customerCrm.count({ where: { tenantId, churnScore: { gte: 70 } } }),
      prisma.customerCrm.count({ where: { tenantId, ltv: { gte: 500 } } }),
      prisma.customerCrm.count({
        where: { tenantId, createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
      }),
      prisma.customerCrm.count({
        where: {
          tenantId,
          lastOrderDate: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        total,
        atRisk,
        vip,
        new: newCustomers,
        inactive,
        segments: [
          { id: 'all', name: 'All Customers', count: total },
          { id: 'at-risk', name: 'At Risk', count: atRisk },
          { id: 'vip', name: 'VIP', count: vip },
          { id: 'new', name: 'New (30 days)', count: newCustomers },
          { id: 'inactive', name: 'Inactive (90+ days)', count: inactive }
        ]
      }
    });
  } catch (error) {
    logger.error('Customer segments failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch segments' });
  }
});

// GET /api/v1/customers/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const { id } = req.params;

    const customer = await prisma.customerCrm.findFirst({
      where: { id, tenantId }
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ success: true, data: customer });
  } catch (error) {
    logger.error('Customer fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

module.exports = router;