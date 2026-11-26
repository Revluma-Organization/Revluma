-- C2 repair (tie-only, minimal blast radius). NOT YET EXECUTED.
--
-- Keeps the earliest (created_at, id) row of each tied (conversation_id,
-- sequence_number) group on its number; renumbers only the excess rows above
-- the conversation's current maximum, in deterministic
-- (sequence_number, created_at, id) order. Untied rows are never touched.
--
-- Idempotent: a second run updates zero rows. Single UPDATE statement, safe
-- to re-run any time before the UNIQUE migration.
--
-- Before-state (2026-11-26, org-wide): 109 tied groups, all exactly pairs,
-- 57 conversations, 109 excess rows to move, 0 NULL sequences, 0 groups
-- sharing created_at. Re-check the blast radius before running (see README).
WITH excess AS (
  SELECT
    id,
    conversation_id,
    sequence_number,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY conversation_id, sequence_number
      ORDER BY created_at, id
    ) AS keeper_rank
  FROM conversation_messages
),
conversation_max AS (
  SELECT conversation_id, MAX(sequence_number) AS max_seq
  FROM conversation_messages
  GROUP BY conversation_id
),
renumbered AS (
  SELECT
    e.id,
    m.max_seq + ROW_NUMBER() OVER (
      PARTITION BY e.conversation_id
      ORDER BY e.sequence_number, e.created_at, e.id
    ) AS new_seq
  FROM excess e
  JOIN conversation_max m ON m.conversation_id = e.conversation_id
  WHERE e.keeper_rank > 1
)
UPDATE conversation_messages cm
SET sequence_number = r.new_seq
FROM renumbered r
WHERE r.id = cm.id;

-- Verification (run as a separate statement on single-statement runners).
-- Expect tied_groups_remaining = 0 before promoting migration.sql.
SELECT COUNT(*) AS tied_groups_remaining
FROM (
  SELECT conversation_id, sequence_number
  FROM conversation_messages
  GROUP BY conversation_id, sequence_number
  HAVING COUNT(*) > 1
) ties;
