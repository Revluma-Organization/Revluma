const prisma = require("../../configs/database").prisma;

const getUserOrganization = async (userId) => {
  return prisma.organizations.findFirst({
    where: { owner_id: userId },
    select: { id: true },
  });
};

const getOrgStoreIds = async (orgId) => {
  const stores = await prisma.stores.findMany({
    where: { organization_id: orgId },
    select: { id: true },
  });
  return stores.map((s) => s.id);
};

exports.getKpis = async (req, res, next) => {
  try {
    const org = await getUserOrganization(req.user.id);
    if (!org) {
      return res.status(200).json({
        success: true,
        data: { kpi: emptyKpis() },
      });
    }

    const storeIds = await getOrgStoreIds(org.id);

    const [
      recoveredOrders,
      totalAbandoned,
      activeCustomers,
      atRiskCarts,
    ] = await Promise.all([
      prisma.orders.aggregate({
        where: {
          store_id: { in: storeIds },
          recovery_status: "recovered",
        },
        _sum: { total: true },
        _count: true,
      }),
      prisma.abandoned_carts.count({
        where: {
          store_id: { in: storeIds },
          status: { in: ["abandoned", "in_sequence", "recovered"] },
        },
      }),
      prisma.customers.count({
        where: { store_id: { in: storeIds }, status: "active" },
      }),
      prisma.abandoned_carts.aggregate({
        where: {
          store_id: { in: storeIds },
          status: "abandoned",
        },
        _sum: { cart_value: true },
      }),
    ]);

    const recoveredCount = recoveredOrders._count;
    const recoveryRate =
      totalAbandoned > 0
        ? ((recoveredCount / totalAbandoned) * 100).toFixed(1) + "%"
        : "0%";
    const recoveredRevenue = Number(recoveredOrders._sum.total || 0);
    const riskValue = Number(atRiskCarts._sum.cart_value || 0);

    const kpi = [
      {
        id: "rev",
        label: "Revenue Recovered",
        value: `$${recoveredRevenue.toLocaleString()}`,
        delta: recoveredRevenue > 0 ? "+" : "0",
        dir: recoveredRevenue > 0 ? "up" : "neutral",
        bench: "avg +12%",
        color: "green",
        iconKey: "dollar",
        zero: recoveredRevenue === 0,
      },
      {
        id: "carts",
        label: "Abandoned Carts",
        value: totalAbandoned.toString(),
        delta: "0 today",
        dir: "neutral",
        atRisk: `$${riskValue.toLocaleString()} at risk`,
        color: "amber",
        iconKey: "cart",
        zero: totalAbandoned === 0,
      },
      {
        id: "rate",
        label: "Recovery Rate",
        value: recoveryRate,
        delta: totalAbandoned > 0 ? "+" : "0",
        dir: totalAbandoned > 0 ? "up" : "neutral",
        bench: "top: 28%",
        color: "blue",
        iconKey: "trend",
        zero: totalAbandoned === 0,
      },
      {
        id: "subs",
        label: "Active Subscribers",
        value: activeCustomers.toLocaleString(),
        delta: "0 this wk",
        dir: "neutral",
        bench: "list growth",
        color: "purple",
        iconKey: "users",
        zero: activeCustomers === 0,
      },
      {
        id: "risk",
        label: "Revenue at Risk",
        value: `$${riskValue.toLocaleString()}`,
        delta: "Active now",
        dir: "neutral",
        bench: "open carts",
        color: "red",
        iconKey: "alert",
        zero: riskValue === 0,
      },
      {
        id: "score",
        label: "Opportunity Score",
        value: totalAbandoned > 0 ? "50/100" : "0/100",
        delta: totalAbandoned > 0 ? "Medium" : "Low",
        dir: totalAbandoned > 0 ? "neutral" : "neutral",
        bench: "top 15%",
        color: "purple",
        iconKey: "star",
        zero: totalAbandoned === 0,
      },
    ];

    return res.status(200).json({ success: true, data: { kpi } });
  } catch (error) {
    next(error);
  }
};

exports.getChart = async (req, res, next) => {
  try {
    const org = await getUserOrganization(req.user.id);
    if (!org) {
      return res.status(200).json({
        success: true,
        data: { chart: emptyChart() },
      });
    }

    const storeIds = await getOrgStoreIds(org.id);
    if (storeIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { chart: emptyChart() },
      });
    }

    const now = new Date();
    const days90 = new Date(now);
    days90.setDate(days90.getDate() - 90);

    const [orders, carts] = await Promise.all([
      prisma.orders.findMany({
        where: {
          store_id: { in: storeIds },
          ordered_at: { gte: days90 },
        },
        select: { ordered_at: true, total: true, recovery_status: true },
      }),
      prisma.abandoned_carts.findMany({
        where: {
          store_id: { in: storeIds },
          abandoned_at: { gte: days90 },
        },
        select: { abandoned_at: true, cart_value: true },
      }),
    ]);

    const chart = buildChartData(orders, carts);
    return res.status(200).json({ success: true, data: { chart } });
  } catch (error) {
    next(error);
  }
};

exports.getActivity = async (req, res, next) => {
  try {
    const org = await getUserOrganization(req.user.id);
    if (!org) {
      return res.status(200).json({
        success: true,
        data: { activity: [] },
      });
    }

    const storeIds = await getOrgStoreIds(org.id);
    if (storeIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: { activity: [] },
      });
    }

    const events = await prisma.events.findMany({
      where: {
        store_id: { in: storeIds },
        event_type: { in: ["cart_recovered", "cart_abandoned", "email_capture"] },
      },
      orderBy: { created_at: "desc" },
      take: 20,
      select: {
        id: true,
        event_type: true,
        payload: true,
        created_at: true,
        stores: { select: { shop_domain: true } },
      },
    });

    const activity = events.map((e) => ({
      id: e.id,
      name: "Store",
      initials: "ST",
      text: formatEventText(e.event_type, e.payload),
      amt: formatEventAmt(e.event_type, e.payload),
      time: formatTime(e.created_at),
      tag: formatEventTag(e.event_type),
    }));

    return res.status(200).json({ success: true, data: { activity } });
  } catch (error) {
    next(error);
  }
};

function emptyKpis() {
  return [
    { id: "rev", label: "Revenue Recovered", value: "$0", delta: "0", dir: "neutral", bench: "avg +12%", color: "green", iconKey: "dollar", zero: true },
    { id: "carts", label: "Abandoned Carts", value: "0", delta: "0 today", dir: "neutral", atRisk: "$0 at risk", color: "amber", iconKey: "cart", zero: true },
    { id: "rate", label: "Recovery Rate", value: "0%", delta: "0", dir: "neutral", bench: "top: 28%", color: "blue", iconKey: "trend", zero: true },
    { id: "subs", label: "Active Subscribers", value: "0", delta: "0 this wk", dir: "neutral", bench: "list growth", color: "purple", iconKey: "users", zero: true },
    { id: "risk", label: "Revenue at Risk", value: "$0", delta: "Active now", dir: "neutral", bench: "open carts", color: "red", iconKey: "alert", zero: true },
    { id: "score", label: "Opportunity Score", value: "0/100", delta: "Low", dir: "neutral", bench: "top 15%", color: "purple", iconKey: "star", zero: true },
  ];
}

function emptyChart() {
  const days7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return { label: d.toLocaleDateString("en-US", { weekday: "short" }), abandoned: 0, recovered: 0, revenue: 0 };
  });
  const weeks4 = Array.from({ length: 4 }, (_, i) => ({
    label: `W${i + 1}`, abandoned: 0, recovered: 0, revenue: 0,
  }));
  const months3 = Array.from({ length: 3 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (2 - i));
    return { label: d.toLocaleDateString("en-US", { month: "short" }), abandoned: 0, recovered: 0, revenue: 0 };
  });

  return { "7d": days7, "30d": weeks4, "90d": months3 };
}

function buildChartData(orders, carts) {
  const now = new Date();

  const days7 = [];
  const weeks4 = [];
  const months3 = [];

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString("en-US", { weekday: "short" });

    const dayOrders = orders.filter((o) => o.ordered_at.toISOString().split("T")[0] === key);
    const dayCarts = carts.filter((c) => c.abandoned_at.toISOString().split("T")[0] === key);

    const abandoned = dayCarts.length;
    const recovered = dayOrders.filter((o) => o.recovery_status === "recovered").length;
    const revenue = dayOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

    days7.push({ label, abandoned, recovered, revenue: Math.round(revenue) });
  }

  for (let w = 0; w < 4; w++) {
    const start = new Date(now);
    start.setDate(start.getDate() - 27 + w * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const weekOrders = orders.filter((o) => o.ordered_at >= start && o.ordered_at <= end);
    const weekCarts = carts.filter((c) => c.abandoned_at >= start && c.abandoned_at <= end);

    const abandoned = weekCarts.length;
    const recovered = weekOrders.filter((o) => o.recovery_status === "recovered").length;
    const revenue = weekOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

    weeks4.push({
      label: `W${w + 1}`,
      abandoned,
      recovered,
      revenue: Math.round(revenue),
    });
  }

  for (let m = 2; m >= 0; m--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - m, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - m + 1, 0, 23, 59, 59);

    const monthOrders = orders.filter((o) => o.ordered_at >= monthStart && o.ordered_at <= monthEnd);
    const monthCarts = carts.filter((c) => c.abandoned_at >= monthStart && c.abandoned_at <= monthEnd);

    const abandoned = monthCarts.length;
    const recovered = monthOrders.filter((o) => o.recovery_status === "recovered").length;
    const revenue = monthOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

    months3.push({
      label: monthStart.toLocaleDateString("en-US", { month: "short" }),
      abandoned,
      recovered,
      revenue: Math.round(revenue),
    });
  }

  return { "7d": days7, "30d": weeks4, "90d": months3 };
}

  for (let i = 27; i >= 0; i -= 7) {
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() - i);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);

    const weekOrders = orders.filter((o) => {
      const date = o.ordered_at;
      return date >= weekStart && date <= weekEnd;
    });
    const weekCarts = carts.filter((c) => {
      const date = c.abandoned_at;
      return date >= weekStart && date <= weekEnd;
    });

    const abandoned = weekCarts.length;
    const recovered = weekOrders.filter((o) => o.recovery_status === "recovered").length;
    const revenue = weekOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

    weeks4.push({
      label: `W${Math.floor((27 - i) / 7) + 1}`,
      abandoned,
      recovered,
      revenue: Math.round(revenue),
    });
  }

  for (let i = 2; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);

    const monthOrders = orders.filter((o) => o.ordered_at >= monthStart && o.ordered_at <= monthEnd);
    const monthCarts = carts.filter((c) => c.abandoned_at >= monthStart && c.abandoned_at <= monthEnd);

    const abandoned = monthCarts.length;
    const recovered = monthOrders.filter((o) => o.recovery_status === "recovered").length;
    const revenue = monthOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);

    months3.push({
      label: monthStart.toLocaleDateString("en-US", { month: "short" }),
      abandoned,
      recovered,
      revenue: Math.round(revenue),
    });
  }

  return { "7d": days7, "30d": weeks4, "90d": months3 };
}

function formatEventText(eventType, payload) {
  if (eventType === "cart_recovered") return "Cart recovered";
  if (eventType === "cart_abandoned") return "New abandoned cart";
  if (eventType === "email_capture") return "New subscriber";
  return "Activity";
}

function formatEventAmt(eventType, payload) {
  if (eventType === "cart_recovered" || eventType === "cart_abandoned") {
    const val = payload?.cart_value || 0;
    return `$${Number(val).toLocaleString()}`;
  }
  if (eventType === "email_capture") return "—";
  return "—";
}

function formatTime(date) {
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function formatEventTag(eventType) {
  if (eventType === "cart_recovered") return "recovery";
  if (eventType === "cart_abandoned") return "cart";
  if (eventType === "email_capture") return "subscribe";
  return "campaign";
}
