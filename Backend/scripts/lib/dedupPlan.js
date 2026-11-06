'use strict';

// Pure identity-resolution and duplicate planning for abandoned carts.
// No database, no side effects; unit-tested in isolation.

const CHECKOUT_ID_RE = /(?:checkout[/:](?:gid:\/\/shopify\/Checkout\/)?)?(\d{6,})/i;

// Normalize any checkout/cart representation to one canonical key per store.
// Preference: explicit source_checkout_id > digits embedded in external_cart_id
// (Shopify numeric checkout id is globally unique per store) > opaque tokens
// (cart tokens are unique per store too, but opaque: kept as-is).
function canonicalCheckoutIdentity(row) {
  const store = row.storeId;
  const fromSource = numericId(row.sourceCheckoutId);
  if (fromSource) return `${store}|checkout|${fromSource}`;
  const fromExternal = row.externalCartId ? numericId(row.externalCartId) : null;
  if (fromExternal) return `${store}|checkout|${fromExternal}`;
  const token = row.sourceCartToken || row.sourceCheckoutToken || row.externalCartId;
  if (token) return `${store}|token|${String(token).trim()}`;
  return null; // no identity — never merged with anything
}

function numericId(value) {
  if (value == null) return null;
  const m = String(value).match(CHECKOUT_ID_RE);
  return m ? m[1] : null;
}

function planDedup(rows) {
  const groups = new Map();
  let unidentified = 0;
  for (const row of rows) {
    const identity = canonicalCheckoutIdentity(row);
    if (!identity) { unidentified++; continue; }
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(row);
  }
  const plan = [];
  for (const [identity, members] of groups) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => {
      const t = new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
      if (t !== 0) return t;
      return Number(b.cartValue || 0) - Number(a.cartValue || 0);
    });
    plan.push({
      identity,
      storeId: sorted[0].storeId,
      keep: sorted[0],
      supersede: sorted.slice(1),
      rows: sorted,
    });
  }
  return {
    rowsScanned: rows.length,
    unidentified,
    groups: plan,
    totalSuperseded: plan.reduce((n, g) => n + g.supersede.length, 0),
  };
}

module.exports = { canonicalCheckoutIdentity, planDedup };
