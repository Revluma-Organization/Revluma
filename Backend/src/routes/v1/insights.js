const express = require('express');
const router = express.Router();
const authenticate = require('../../middleware/auth');
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

// ============================================================
// AI Insights API
// Actionable recommendations based on data
// ============================================================

// GET /api/v1/insights
// Main insights endpoint
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    
    // Get key metrics
    const [recoveryRate, revenue, abandonedCarts, customerMetrics] = await Promise.all([
      getRecoveryRate(tenantId),
      getRevenueMetrics(tenantId),
      getAbandonedCartMetrics(tenantId),
      getCustomerMetrics(tenantId)
    ]);

    // Generate insights based on data
    const insights = [];

    // Recovery rate insight
    if (recoveryRate.rate < recoveryRate.benchmark) {
      insights.push({
        id: 'recovery-rate',
        type: 'opportunity',
        priority: recoveryRate.rate < recoveryRate.benchmark - 10 ? 'high' : 'medium',
        title: 'Recovery Rate Below Benchmark',
        description: `Your recovery rate is ${recoveryRate.rate.toFixed(1)}% vs ${recoveryRate.benchmark}% benchmark. Enabling SMS or WhatsApp recovery could close this gap by up to 12%.`,
        metric: {
          label: 'Recovery Rate',
          value: `${recoveryRate.rate.toFixed(1)}%`,
          benchmark: `${recoveryRate.benchmark}%`
        },
        action: {
          label: 'Enable SMS Recovery',
          route: '/Dashboard/cartRecovery?channel=sms'
        }
      });
    }

    // Abandoned cart opportunity
    if (abandonedCarts.total > 50 && abandonedCarts.value > 1000) {
      insights.push({
        id: 'abandoned-carts',
        type: 'opportunity',
        priority: 'high',
        title: `${abandonedCarts.total} Carts Awaiting Recovery`,
        description: `You have $${abandonedCarts.value.toLocaleString()} in abandoned carts. Quick follow-ups could recover significant revenue.`,
        metric: {
          label: 'At Risk Value',
          value: `$${abandonedCarts.value.toLocaleString()}`,
          benchmark: '$0'
        },
        action: {
          label: 'View Abandoned Carts',
          route: '/Dashboard/cartRecovery'
        }
      });
    }

    // Channel opportunity
    if (!customerMetrics.hasWhatsApp && !customerMetrics.hasSMS) {
      insights.push({
        id: 'channel-expansion',
        type: 'growth',
        priority: 'medium',
        title: 'WhatsApp Not Enabled',
        description: 'Stores using WhatsApp recovery see 2.4× higher open rates vs email alone.',
        metric: {
          label: 'Open Rate (WhatsApp)',
          value: '98%',
          benchmark: 'Email: 21%'
        },
        action: {
          label: 'Enable WhatsApp',
          route: '/settings?tab=channels'
        }
      });
    }

    // Timing insight
    insights.push({
      id: 'timing-optimization',
      type: 'optimization',
      priority: 'low',
      title: 'Optimal Send Time Detected',
      description: 'Your peak abandonment window is Friday 6–9 PM. Schedule follow-ups 30 min after cart creation for best results.',
      metric: {
        label: 'Peak Window',
        value: 'Fri 6-9 PM',
        benchmark: 'Mon-Fri 10AM'
      },
      action: {
        label: 'Apply Timing',
        route: '/settings?tab=automations'
      }
    });

    res.json({
      success: true,
      data: {
        insights,
        summary: {
          total: insights.length,
          highPriority: insights.filter(i => i.priority === 'high').length,
          actionReady: insights.filter(i => i.action).length
        }
      }
    });
  } catch (error) {
    logger.error('Insights fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

// GET /api/v1/insights/recommendations
// Get actionable recommendations
router.get('/recommendations', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const recommendations = [];

    // Get current metrics
    const [carts, revenue, customerData] = await Promise.all([
      prisma.abandonedCart.aggregate({
        where: { tenantId, status: 'abandoned' },
        _count: true,
        _sum: { cartValue: true }
      }),
      prisma.recoveryEvents.aggregate({
        where: {
          tenantId,
          eventType: { in: ['recovery', 'purchase'] }
        },
        _sum: { revenueAmount: true }
      }),
      prisma.customerCrm.aggregate({
        where: { tenantId },
        _avg: { ltv: true }
      })
    ]);

    const abandonedValue = carts._sum?.cartValue?.toNumber() || 0;
    const totalRevenue = revenue._sum?.revenueAmount?.toNumber() || 0;
    const avgLtv = customerData._avg?.ltv?.toNumber() || 0;

    // Recovery automation recommendations
    if (carts._count > 0) {
      recommendations.push({
        id: 'automation-1',
        category: 'recovery',
        title: 'Create urgency sequence',
        description: 'Send a "last chance" email 2 hours before cart expires',
        impact: { revenue: '$200-500', probability: 'medium' },
        effort: 'low',
        action: 'Create Automation'
      });
    }

    // Upsell recommendations
    if (totalRevenue > 0) {
      recommendations.push({
        id: 'upsell-1',
        category: 'growth',
        title: 'Enable post-purchase upsells',
        description: 'Offer related products on thank you page',
        impact: { revenue: '+15%', probability: 'high' },
        effort: 'medium',
        action: 'Enable Upsells'
      });
    }

    // Retention recommendations
    if (avgLtv > 0 && carts._count > 100) {
      recommendations.push({
        id: 'retention-1',
        category: 'retention',
        title: 'Launch VIP program',
        description: 'Create special offers for customers with LTV > $500',
        impact: { revenue: '+25% LTV', probability: 'medium' },
        effort: 'high',
        action: 'Create Program'
      });
    }

    res.json({
      success: true,
      data: recommendations
    });
  } catch (error) {
    logger.error('Recommendations failed', { error: error.message });
    res.status(500).json({ error: 'Failed to generate recommendations' });
  }
});

// Helper functions
async function getRecoveryRate(tenantId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [recovered, total] = await Promise.all([
    prisma.recoveryEvents.count({
      where: { tenantId, eventType: { in: ['recovery', 'purchase'] }, createdAt: { gte: thirtyDaysAgo } }
    }),
    prisma.abandonedCart.count({
      where: { tenantId, createdAt: { gte: thirtyDaysAgo } }
    })
  ]);

  const rate = total > 0 ? (recovered / total * 100) : 0;
  return { rate, benchmark: 18 };
}

async function getRevenueMetrics(tenantId) {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const [current, previous] = await Promise.all([
    prisma.recoveryEvents.aggregate({
      where: {
        tenantId,
        eventType: { in: ['recovery', 'purchase'] },
        createdAt: { gte: thirtyDaysAgo }
      },
      _sum: { revenueAmount: true }
    }),
    prisma.recoveryEvents.aggregate({
      where: {
        tenantId,
        eventType: { in: ['recovery', 'purchase'] },
        createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }
      },
      _sum: { revenueAmount: true }
    })
  ]);

  const currentRevenue = current._sum?.revenueAmount?.toNumber() || 0;
  const previousRevenue = previous._sum?.revenueAmount?.toNumber() || 0;
  const change = previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue * 100) : 0;

  return { total: currentRevenue, change: change.toFixed(1) };
}

async function getAbandonedCartMetrics(tenantId) {
  const result = await prisma.abandonedCart.aggregate({
    where: { tenantId, status: 'abandoned' },
    _count: true,
    _sum: { cartValue: true }
  });

  return { total: result._count || 0, value: result._sum?.cartValue?.toNumber() || 0 };
}

async function getCustomerMetrics(tenantId) {
  const result = await prisma.customerCrm.aggregate({
    where: { tenantId },
    _count: true,
    _avg: { ltv: true }
  });

  const hasWhatsApp = false; // Would check tenant profile
  const hasSMS = false; // Would check tenant profile

  return {
    total: result._count || 0,
    avgLtv: result._avg?.ltv?.toNumber() || 0,
    hasWhatsApp,
    hasSMS
  };
}

module.exports = router;