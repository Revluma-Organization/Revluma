'use strict';

// Pure schema↔registry comparator. No network, no Prisma, no side effects.
// Given a Shopify Admin GraphQL __schema introspection result and Revluma's
// resource registry, produce the honest gap report:
//   1. Registry resources whose query roots are MISSING from the schema
//      (deprecated/removed in this API version).
//   2. Schema query-root field names referenced by the registry but absent
//      (likely field-level differences — note, marked for human review).
//   3. Schema root query fields that look commercially relevant but are
//      absent from the registry (new coverage candidates).
// The output is NEVER used to imply we already ingest anything — it is a
// discovery delta only.

const COMMERCE_ROOT_HINTS = [
  'order', 'product', 'variant', 'customer', 'inventory', 'checkout',
  'market', 'discount', 'refund', 'fulfillment', 'transaction', 'metafield',
  'metaobject', 'collection', 'page', 'blog', 'article', 'theme', 'discount',
  'pricelist', 'sellingplan', 'subscription', 'draftorder', 'locations',
  'publication', 'file', 'translation', 'audience', 'return', 'webhook',
];

function isCommerceRoot(fieldName) {
  const f = String(fieldName || '').toLowerCase();
  return COMMERCE_ROOT_HINTS.some(hint => f.includes(hint));
}

function compareRegistryAgainstSchema(schema, registry) {
  const findings = [];
  const warnings = [];
  const queryFields = new Set(
    (schema?.queryType?.fields || []).map(f => f.name).filter(Boolean)
  );
  const mutationFields = new Set(
    (schema?.mutationType?.fields || []).map(f => f.name).filter(Boolean)
  );
  const typeNames = new Set((schema?.types || []).map(t => t.name).filter(Boolean));

  if (!queryFields.size && !typeNames.size) {
    return { status: 'SCHEMA_UNAVAILABLE', findings, warnings, unknowns: ['__schema parse empty — introspection not available for this token'] };
  }

  // 1. Registry → schema: queryRoots if declared (exact membership), else hint match.
  for (const entry of registry) {
    const declared = Array.isArray(entry.queryRoots) ? entry.queryRoots : null;
    if (declared && declared.length) {
      const missing = declared.filter(root => root !== 'node' && !queryFields.has(root));
      if (missing.length) {
        warnings.push({ kind: 'registry_query_root_absent', resource: entry.id, missing_roots: missing, message: 'Declared query root(s) absent from schema — deprecated, renamed, or version drift' });
      }
      continue;
    }
    const hint = String(entry.id.split('.')[0]).toLowerCase().replace(/-/g, '');
    if (hint && ![...queryFields].some(f => String(f).toLowerCase().includes(hint))) {
      warnings.push({ kind: 'registry_root_unmatched', resource: entry.id, message: 'No query-root field with matching hint found in schema; verify against docs' });
    }
  }

  // 2. Schema → registry: commerce-looking roots the registry never models.
  const covered = new Set(registry.flatMap(entry => entry.id.split('.')));
  for (const field of queryFields) {
    if (isCommerceRoot(field) && !covered.has(String(field).toLowerCase().replace(/s$/, ''))) {
      findings.push({ kind: 'schema_root_uncovered', field, note: 'Commerce-looking query root with no registry entry — review for acquisition candidacy' });
    }
  }

  return {
    status: findings.length || warnings.length ? 'GAPS_FOUND' : 'REGISTRY_CONSISTENT',
    findings,
    warnings,
    unknowns: [],
  };
}

module.exports = { compareRegistryAgainstSchema, isCommerceRoot };
