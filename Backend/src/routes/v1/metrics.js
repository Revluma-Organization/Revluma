const express = require('express');
const router = express.Router();
const authenticate = require('../../middleware/auth');
const { prisma } = require('../../services/prisma');
const logger = require('../../utils/logger');

// ============================================================
// Metrics API
// Detailed metrics for dashboard charts
// ============================================================

// GET /api/v1/metrics
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const { range = '30d', type = 'revenue' } = req.query;

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
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get events by type over time
    const events = await prisma.recoveryEvents.findMany({
      where: {
        tenantId,
        eventType: { in: ['recovery', 'purchase', 'abandoned'] },
        createdAt: { gte: startDate }
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        eventType: true,
        revenueAmount: true,
        createdAt: true
      }
    });

    // Group by day for chart data
    const dailyData = {};
    events.forEach(event => {
      const dateKey = event.createdAt.toISOString().split('T')[0];
      if (!dailyData[dateKey]) {
        dailyData[dateKey] = { date: dateKey, revenue: 0, recoveries: 0, abandoned: 0 };
      }
      if (event.eventType === 'recovery' || event.eventType === 'purchase') {
        dailyData[dateKey].revenue += event.revenueAmount?.toNumber() || 0;
        dailyData[dateKey].recoveries += 1;
      } else {
        dailyData[dateKey].abandoned += 1;
      }
    });

    const chartData = Object.values(dailyData);

    // Calculate totals
    const totals = {
      revenue: chartData.reduce((sum, d) => sum + d.revenue, 0),
      recoveries: chartData.reduce((sum, d) => sum + d.recoveries, 0),
      abandoned: chartData.reduce((sum, d) => sum + d.abandoned, 0)
    };

    // Calculate recovery rate
    const totalEvents = totals.recoveries + totals.abandoned;
    const recoveryRate = totalEvents > 0 ? (totals.recoveries / totalEvents * 100) : 0;

    res.json({
      success: true,
      data: {
        period: range,
        labels: chartData.map(d => d.date),
        current: chartData.map(d => d.revenue),
        previous: [], // Would need historical comparison
        recoveryRate,
        totals
      }
    });
  } catch (error) {
    logger.error('Metrics fetch failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// GET /api/v1/metrics/revenue
router.get('/revenue', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;
    const { range = '30d' } = req.query;

    const now = new Date();
    const startDate = new Date(now.getTime() - parseInt(range) * 24 * 60 * 60 * 1000);

    const revenueData = await prisma.recoveryEvents.aggregate({
      where: {
        tenantId,
        eventType: { in: ['recovery', 'purchase'] },
        createdAt: { gte: startDate }
      },
      _sum: { revenueAmount: true },
      _count: true
    });

    // Get previous period for comparison
    const prevStartDate = new Date(startDate.getTime() - parseInt(range) * 24 * 60 * 60 * 1000);
    const prevRevenueData = await prisma.recoveryEvents.aggregate({
      where: {
        tenantId,
        eventType: { in: ['recovery', 'purchase'] },
        createdAt: {
          gte: prevStartDate,
          lt: startDate
        }
      },
      _sum: { revenueAmount: true }
    });

    const currentRevenue = revenueData._sum?.revenueAmount?.toNumber() || 0;
    const previousRevenue = prevRevenueData._sum?.revenueAmount?.toNumber() || 0;
    const change = previousRevenue > 0 
      ? ((currentRevenue - previousRevenue) / previousRevenue * 100)
      : 0;

    res.json({
      success: true,
      data: {
        value: currentRevenue,
        count: revenueData._count || 0,
        change: change.toFixed(1),
        previous: previousRevenue,
        benchmark: 12 // 12% is industry average
      }
    });
  } catch (error) {
    logger.error('Revenue metrics failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch revenue metrics' });
  }
});

// GET /api/v1/metrics/customers
router.get('/customers', authenticate, async (req, res) => {
  try {
    const tenantId = req.user.tenant_id;

    const [totalCustomers, newCustomers, avgLtv] = await Promise.all([
      prisma.customerCrm.count({ where: { tenantId } }),
      prisma.customerCrm.count({
        where: {
          tenantId,
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
        }
      }),
      prisma.customerCrm.aggregate({
        where: { tenantId },
        _avg: { ltv: true }
      })
    ]);

    res.json({
      success: true,
      data: {
        total: totalCustomers,
        new: newCustomers,
        avgLtv: avgLtv._avg?.ltv?.toNumber() || 0
      }
    });
  } catch (error) {
    logger.error('Customer metrics failed', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch customer metrics' });
  }
});

module.exports = router;