# H2 Eval-Burst Candidates — SELECT-first list (NOT applied)

**Date:** 2026-11-26. **Org:** Splendor's Store (`1dc6aa19-9737-4770-a340-ff812a8b139a`).
**Status:** proposed for approval. No UPDATE/DELETE has been run. No annotation applied.

## Detection queries (reproducible)

```sql
-- B1: identical user text ≥3× in one conversation within 60 minutes
SELECT conversation_id, LEFT(content->>'text', 70) AS q, COUNT(*) AS n,
       MIN(created_at) AS first, MAX(created_at) AS last
FROM conversation_messages
WHERE organization_id = '1dc6aa19-9737-4770-a340-ff812a8b139a' AND role = 'user'
GROUP BY 1, 2 HAVING COUNT(*) >= 3
  AND MAX(created_at) - MIN(created_at) <= INTERVAL '60 minutes'
ORDER BY 4;
-- request 61c48340 → 5 groups, 24 messages (ids below, request 4941ce92)

-- B2: 8/20 smoke-sweep day (2-3 messages per conversation, ~1s apart, 11 errors)
SELECT conversation_id, COUNT(*) AS n,
       COUNT(*) FILTER (WHERE has_error) AS err,
       MIN(created_at) AS first, MAX(created_at) AS last
FROM conversation_messages
WHERE organization_id = '1dc6aa19-9737-4770-a340-ff812a8b139a'
  AND created_at >= '2026-08-20' AND created_at < '2026-08-21'
GROUP BY 1 ORDER BY 2 DESC;
-- request 0aeef2e2 → 13 conversations (ids below)
```

## Burst groups (B1) — 24 user messages proposed for annotation

| # | Conversation | Question (trunc.) | n | Window (UTC 2026) | Verdict |
|---|---|---|---|---|---|
| G1 | `7937a215` | Why do most cart recovery emails fail? | 4 | 9/15 17:50:46–17:51:09 (23s) | scripted burst |
| G2 | `7937a215` | What are the best Shopify apps for cart recovery in 2026? | 8 | 9/15 17:53:29–17:54:15 (46s) | scripted burst (alternating INTELLIGENCE_INVALID_RESPONSE) |
| G3 | `d481efbd` | What are the most common reasons Shopify stores see ROAS dec… | 4 | 9/15 20:42:52–20:43:04 (12s) | scripted burst |
| G4 | `eb8aae6c` | What do you currently know about my connected store? Tell me… | 4 | 10/28 14:03:54–14:11:44 (~8m, two sub-second pairs) | likely scripted (double-submit pairs + re-ask) |
| G5 | `152a0311` | Why are customers abandoning their carts, which opportunitie… | 4 | 10/28 23:14:37–23:46:05 (~32m) | human re-asks — **proposed: annotate as `likely_human`, not eval** |

Message ids (user rows, in time order):

- G1: `884b60ef-6820-4906-b871-b8b45784f98d`, `e86a34f3-4adc-434d-8c08-95d423d7901b`,
  `dc9d7e44-ee69-4ab3-8986-751bc4b72f06`, `8aefc69c-31a9-4e98-88ba-bed57a75d6e7`
- G2: `080365f6-f0a6-41d9-934d-ff8b2e60421a`, `f5cc992a-db0c-4721-8502-c366299f45ab`,
  `16d649a6-877d-40b5-addd-3b9810b1fd01`, `38fb3ddf-05aa-4911-98be-877657fd3675`,
  `9e49bd78-1c9d-4221-9e89-026dd05085ee`, `430215fb-8972-47fd-8cb6-9364e15bdf0d`,
  `d0aa1e23-54ac-4530-84b9-ce6fb21368cf`, `b658c029-5410-44c6-9380-10ff5f5eb684`
- G3: `5060ea01-db83-4496-b10b-6a58dfd5926d`, `f921a094-4b75-4fdf-9115-9bd07bdd666d`,
  `d20046fd-5dd3-46ea-a347-995a094140d2`, `6b66d5ce-c0b3-42fe-bfde-081e166870fb`
- G4: `29662b7f-09d7-4186-9633-c90a24c0c221`, `f2922ec1-b33d-4d8d-a213-8ed576506b53`,
  `6529fe6a-c01e-495d-bad1-1d0a1897c312`, `82b656cd-375b-44c6-bf74-f017de72753f`
- G5: `3a308ce3-4b93-4ebc-b661-3a8a12a290af`, `733857c1-3fe8-4d4d-b69d-4994c4c6d9db`,
  `cc7b7824-b731-4376-9578-724775046d89`, `d3a58ce9-e05c-4059-be54-5e717c453f1f`

## 8/20 smoke sweep (B2) — 13 conversations, user rows proposed for annotation

Pattern: 2–3 messages per conversation within ~1 second; 11 of 13 carry a rev error.
User-row ids to be enumerated by `WHERE conversation_id IN (…) AND role='user'`
at annotation time (SELECT-first, counts verified before/after).

Error convos (11): `0c1f3980`, `0f49181b`, `951956ea`, `3fe77f6d`, `c5b1e836`,
`cdbfda4b`, `db3adb58`, `89db0dd8`, `183b2157`, `8aec6857`, `aee2b259`
Clean convos (2, still sweep-pattern): `ee6a3b00`, `71e6229a`

## Proposed annotation payload (NOT applied — approval required)

Per user message, merge into existing `metadata` (preserve any present keys):

```json
{
  "eval_burst": {
    "group": "G1|G2|G3|G4|G5|Sweep-2026-08-20",
    "verdict": "scripted_burst|likely_human",
    "detected_by": "H2 candidate queries B1/B2 (2026-11-26)",
    "annotated_at": "<approval timestamp>",
    "note": "Historical annotation only; content, counts, and sequences unchanged."
  }
}
```

G5 proposed verdict: `likely_human` (32-minute spacing is consistent with genuine
re-asks; labeling it eval would be speculation). Everything else: `scripted_burst`.

Rollback: restore each row's prior `metadata` from the pre-annotation snapshot
(full `SELECT id, metadata` dump of the candidate ids, retained with the approval).
