# Production readiness status

This is a current readiness summary, not a production sign-off. The detailed
implementation and validation record is maintained in
[`docs/IMPLEMENTATION_WALKTHROUGH.md`](../../docs/IMPLEMENTATION_WALKTHROUGH.md).

## Verified in the repository

- Five authenticated prediction routes expose typed fallback responses.
- The canonical shopper vector contains 34 fields; M2 uses one matching
  13-field train/predict contract and M4 uses the 21 explicitly named fields.
- Training code tags synthetic runs as non-production and registers artifacts
  only when real-data volume and model-specific quality gates pass.
- M1 registers preprocessing and classification as one inference pipeline.
- Controlled-beta serving prefers MLflow `beta` aliases and falls back to
  `production`; production-only deployments load only `production` aliases.
- RFM and historical-ingestion jobs use structured results and transaction
  boundaries covered by automated tests.
- Backend creates and finalizes M2/M4 observed-label windows, and M3 uses a
  deterministic candidate/control allocation with version attribution.
- A durable automation cycle performs real-data readiness checks, DagsHub
  training, canary aliasing, live evidence collection, promotion, rollback,
  and hot reload without recurring manual commands.
- M4 registration requires both churn layers, and automatic promotion requires
  separate live evidence for `churn_risk` and `churn_early_warning`.
- Merchant memories are embedded and retrieved through tenant-scoped pgvector
  search with bounded lexical fallback.

## Production blockers

1. Every model still requires representative chronological real-data
   evaluation, subgroup review, drift baselines, and a controlled canary.
   The application now collects and evaluates this evidence automatically as
   it matures; it cannot manufacture evidence before real usage exists.
2. The recorded local load test missed the required p99 latency target. A
   staging test from a separate load generator remains required.
3. Security and dependency reports are point-in-time artifacts and must be
   rerun against the release candidate and deployment image.
4. Host billing, deployment secrets, Shopify OAuth grants, and merchant opt-in
   are external trust decisions and remain operator-owned.

## Release decision

The codebase can support continued integration and staging validation, but it
must not be described as certified for production traffic until every blocker
above has objective evidence and an approved rollback plan.
