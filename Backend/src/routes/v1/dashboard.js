const express = require('express');
const router = express.Router();
const authenticate = require('../../middleware/auth');
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

// ============================================================
// Unified Dashboard API
// Returns all commerce data in single call
// ============================================================

// GET /api/v1/dashboard
// Returns complete dashboard summary for authenticated user
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const { range = '30d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;
    switch (range) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case 'today':
        startDate = new Date(now.setHours(0, 0, 0, 0));
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get all metrics in parallel
    const [
      revenueData,
      orderCount,
      customerMetrics,
      recoveredMetrics,
      cartMetrics,
      recentOrders
    ] = await Promise.all([
      // Revenue calculation
      prisma.recoveryEvents.aggregate({
        where: {
          tenantId,
          eventType: 'recovery',
          createdAt: { gte: startDate }
        },
        _sum: { revenueAmount: true },
        _count: true
      }),

      // Order count
      prisma.recoveryEvents.count({
        where: {
          tenantId,
          createdAt: { gte: startDate }
        }
      }),

      // Customer metrics
      prisma.customerCrm.aggregate({
        where: {
          tenantId
        },
        _count: true,
        _avg: { ltv: true }
      }),

      // Recovered revenue
      prisma.recoveryEvents.aggregate({
        where: {
          tenantId,
          eventType: { in: ['recovery', 'purchase'] },
          createdAt: { gte: startDate }
        },
        _sum: { revenueAmount: true }
      }),

      // Abandoned carts
      prisma.abandonedCart.aggregate({
        where: {
          tenantId,
          status: 'abandoned',
          createdAt: { gte: startDate }
        },
        _count: true,
        _sum: { cartValue: true }
      }),

      // Recent orders for activity feed
      prisma.recoveryEvents.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          eventType: true,
          customerEmail: true,
          revenueAmount: true,
          productName: true,
          createdAt: true
        }
      })
    ]);

    // Calculate derived metrics
    const totalRevenue = recoveredMetrics._sum?.revenueAmount?.toNumber() || 0;
    const abandonedValue = cartMetrics._sum?.cartValue?.toNumber() || 0;
    const recoveryRate = orderCount > 0 ? (revenueData._count / orderCount * 100) : 0;
    const opportunityValue = abandonedValue;

    // Build response
    const dashboard = {
      // Timestamp
      generatedAt: new Date().toISOString(),
      period: range,
      
      // Revenue
      revenue: {
        total: totalRevenue,
        recovered: totalRevenue,
        atRisk: opportunityValue,
        change: null // Would need previous period comparison
      },

      // Orders
      orders: {
        total: orderCount,
        recovered: revenueData._count || 0,
        abandoned: cartMetrics._count || 0
      },

      // Recovery
      recovery: {
        rate: recoveryRate,
        benchmark: 18,
        trend: recoveryRate > 18 ? 'up' : 'down'
      },

      // Customers
      customers: {
        total: customerMetrics._count || 0,
        avgLtv: customerMetrics._avg?.ltv?.toNumber() || 0
      },

      // Opportunity
      opportunity: {
        score: Math.min(100, Math.round((opportunityValue / 1000) * 10)),
        value: opportunityValue,
        carts: cartMetrics._count || 0
      },

      // Activity feed
      activity: recentOrders.map(order => ({
        id: order.id,
        type: order.eventType,
        customer: order.customerEmail,
        amount: order.revenueAmount?.toNumber() || 0,
        product: order.productName,
        time: order.createdAt
      }))
    };

    res.json({ success: true, data: dashboard });
  } catch (error) {
    logger.error('Dashboard fetch failed', {
      error: error.message,
      stack: error.stack,
      tenantId: req.user.tenant_id
    });
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// GET /api/v1/dashboard/summary
// Quick summary for headers/live updates
router.get('/summary', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Quick counts
    const [todayRecovery, totalAbandoned, activeCarts] = await Promise.all([
      prisma.recoveryEvents.aggregate({
        where: {
          tenantId,
          eventType: 'recovery',
          createdAt: { gte: today }
        },
        _sum: { revenueAmount: true },
        _count: true
      }),
      prisma.abandonedCart.aggregate({
        where: {
          tenantId,
          status: 'abandoned'
        },
        _sum: { cartValue: true },
        _count: true
      }),
      prisma.abandonedCart.count({
        where: {
          tenantId,
          status: { in: ['abandoned', 'active'] }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        todayRevenue: todayRecovery._sum?.revenueAmount?.toNumber() || 0,
        todayRecoveries: todayRecovery._count || 0,
        atRisk: totalAbandoned._sum?.cartValue?.toNumber() || 0,
        activeCarts: activeCarts,
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Dashboard summary failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

module.exports = router;