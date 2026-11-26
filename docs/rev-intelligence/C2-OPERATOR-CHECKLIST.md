# C2 consolidated operator checklist (Splendor)

Two tasks, ~10 minutes. Everything is read-only: no writes, freezes,
migrations, or repairs. Conversation listing/detail was already established
by production evidence — not repeated here.

## Task 1 — Run the verification script (Windows, no token needed)

File: `docs/rev-intelligence/C2-verify-production.ps1` (this repo).
It GETs Node `/ready` and Python `/health`, compares build SHAs against the
accepted C2-identical commits (`9a133438` = #519, `48957cc` = #522
waitlist-only), and prints PASS/FAIL plus a results block.

```powershell
powershell -ExecutionPolicy Bypass -File C2-verify-production.ps1
```

- Expect `OVERALL: PASS`. Accepted SHAs start with `9a133438` or `48957cc`;
  both services must agree (short-vs-full prefix match is fine).
- On `OVERALL: FAIL`, paste the results block AND the full output.
- Pre-maintenance SHA gate (binding): at window start the script must PASS
  with both SHAs accepted and agreeing. Any other SHA, `unknown`, or
  disagreement stops the window. No Render deploys during the window.

## Task 2 — Supabase recovery evidence (dashboard reads)

Project: Revluma-Database (`jblpgqmbgdlzitprudgt`), eu-west-1.

1. **Plan:** left sidebar → organization menu → Billing (or project Settings
   → General → plan row). Record the exact plan name. PITR needs Pro or
   above — Free must be flagged, it blocks the window.
2. **PITR status + retention:** left sidebar → Database → Backups →
   Point-in-time recovery section. Record ON/OFF and retention days.
3. **Earliest recoverable timestamp:** same Backups page ("earliest point
   of recovery" / restorable range). Record the timestamp + the time you
   read it (UTC).
4. **Latest backup:** same page → scheduled/daily backups list. Record the
   most recent timestamp + its status (must read Completed/successful).

Labels vary slightly by dashboard version — capture verbatim text.
Screenshots are optional backup, not a substitute for pasted values.

## Results template (fill in and return)

```text
SCRIPT: <paste the full RESULTS BLOCK printed by the .ps1>
B1 plan=___
B2 PITR=___ retention_days=___
B3 earliest_recoverable=___ (read at ___Z)
B4 latest_backup=___ status=___
```

That is the entire remaining operator evidence. On receipt, gates flip and
we proceed to final authorization.
