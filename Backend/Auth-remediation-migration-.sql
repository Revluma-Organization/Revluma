-- Keep latest 10 password_history rows per user
DELETE FROM public.password_history
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY "userId"
        ORDER BY "createdAt" DESC
      ) AS rn
    FROM public.password_history
  ) ranked
  WHERE rn > 10
);

-- Remove expired pending registrations
DELETE FROM public.pending_registrations
WHERE "expiresAt" < NOW();

-- Mark password reset tokens as used (if not yet used and not expired)
UPDATE public.password_reset_tokens
SET "usedAt" = NOW()
WHERE "usedAt" IS NULL
  AND "expiresAt" > NOW();