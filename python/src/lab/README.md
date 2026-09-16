# Rev Intelligence Lab

This directory contains synthetic evaluation tooling. It is not imported by
the production serving API and contains no real merchant data.

## Files

- `lume_seed.py` generates deterministic SQL for source tables used by the
  real Business State builder. It does not fabricate `business_states` or
  `alert_queue` rows.
- `scenarios/registry.json` records scenario metadata and readiness. A
  `ground_truth_ready` scenario has a reviewed scoring file, but it is not an
  end-to-end scenario until `pipeline_ready` is `true`.
- `ground_truth/SCN-*.json` contains hidden expected evidence, diagnoses,
  priorities, and recommendations. Rev must never receive this content as
  prompt context.
- `evaluator/evaluate.py` scores a saved Rev response against one reviewed
  ground-truth file. It does not call Rev or the production API.

## Seed workflow

From the repository's `python/` directory with the project virtual environment
active, generate source-table SQL with an existing organization UUID and a
dedicated store UUID for each scenario:

```powershell
python src/lab/lume_seed.py `
  --org-id <organization-uuid> `
  --store-id <scenario-store-uuid> `
  --scenario baseline `
  --as-of 2026-09-16T12:00:00Z `
  --output lume_seed.sql
```

After the SQL transaction is applied, the backend must call these authenticated
Python routes in order:

1. `POST /internal/rfm-sync` with `{"store_id":"<scenario-store-uuid>"}`.
2. `POST /internal/business-state/rebuild` with
   `{"organization_id":"<organization-uuid>"}`.

The evaluator can then score a captured response:

```powershell
python src/lab/evaluator/evaluate.py `
  --scenario SCN-001 `
  --rev-response "<captured response>"
```

The registry is authoritative for current limitations. Scenarios whose required
signals are absent from Business State must remain `pipeline_ready: false` and
must not be reported as end-to-end validated.
