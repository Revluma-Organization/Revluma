const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middlewares/authMiddleware');

// ─── Dashboard stub endpoints ─────────────────────────────────────────────────
// These return valid empty data shapes so the frontend renders correctly
// while the real implementations are being built.
// Replace each handler with the real controller function as they are built.

// GET /api/v1/dashboard/kpis
router.get('/kpis', authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: {
      kpi: [
        { id: "rev",   value: "$0",    delta: "0%",        dir: "neutral", bench: "avg +12%",    spark: [0,0,0,0,0,0,0,0,0,0,0,0] },
        { id: "carts", value: "0",     delta: "0 today",   dir: "neutral", atRisk: "$0 at risk", spark: [0,0,0,0,0,0,0,0,0,0,0,0] },
        { id: "rate",  value: "0%",    delta: "0%",        dir: "neutral", bench: "top: 28%",    spark: [0,0,0,0,0,0,0,0,0,0,0,0] },
        { id: "subs",  value: "0",     delta: "0 this wk", dir: "neutral", bench: "list growth", spark: [0,0,0,0,0,0,0,0,0,0,0,0] },
        { id: "risk",  value: "$0",    delta: "Active now",dir: "neutral", bench: "open carts",  spark: [0,0,0,0,0,0,0,0,0,0,0,0] },
        { id: "score", value: "84/100",delta: "High",      dir: "up",      bench: "top 15%" },
      ]
    }
  });
});

// GET /api/v1/dashboard/chart
router.get('/chart', authenticateToken, (req, res) => {
  const empty7d  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(l => ({ label: l, abandoned: 0, recovered: 0, revenue: 0 }));
  const empty30d = ['W1','W2','W3','W4'].map(l => ({ label: l, abandoned: 0, recovered: 0, revenue: 0 }));
  const empty90d = ['Jan','Feb','Mar'].map(l => ({ label: l, abandoned: 0, recovered: 0, revenue: 0 }));
  res.json({ success: true, data: { chart: { '7d': empty7d, '30d': empty30d, '90d': empty90d } } });
});

// GET /api/v1/dashboard/activity
router.get('/activity', authenticateToken, (req, res) => {
  res.json({ success: true, data: { activity: [] } });
});

module.exports = router;