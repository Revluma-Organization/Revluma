# Backend Setup

## Install and validate

From `Backend/`:

```powershell
npm install
npm run prisma -- validate
npm run prisma -- generate
npm test
```

Use `.env` locally and the deployment host's secret environment settings in
production. Never commit either file or print its values.

## Required environment

Core runtime:

- `DATABASE_URL`: Prisma runtime PostgreSQL connection.
- `DIRECT_URL`: direct PostgreSQL connection used by Prisma migrations. If it
  is omitted, the Prisma wrapper falls back to `DATABASE_URL`.
- `DATABASE_USER`, `DATABASE_HOST`, `DATABASE_PASSWORD`, `DATABASE_PORT`, and
  `DATABASE_NAME`: retained for existing application configuration checks.
- `PORT`, `NODE_ENV`, `FRONTEND_URL`, and `BACKEND_URL`.
- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`,
  `REFRESH_TOKEN_EXPIRES_IN`, `COOKIE_SECRET`, and `GOOGLE_CLIENT_ID`.

Python integration:

- `PYTHON_SERVICE_URL` and `ML_INTERNAL_KEY`.
- `PYTHON_ALLOWED_MODEL_STATUSES` is optional; the default accepts both
  `ready` and `beta_ready`. Narrow it only for a production-only deployment.

Shopify and messaging:

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_REDIRECT_URI`, and
  `SHOPIFY_TOKEN_ENCRYPTION_KEY`.
- Register the exact `SHOPIFY_REDIRECT_URI` value in the Shopify app's allowed
  redirection URLs. It must point to
  `https://<backend-host>/api/v1/shopify/callback` in production.
- `BACKEND_URL` must be the backend's HTTPS origin (no path) so webhook
  subscriptions are created at the correct public URLs.
- `SHOPIFY_API_VERSION` is optional; the service defaults to the current
  quarterly version and rejects versions outside Shopify's supported window.
- `SHOPIFY_SCOPES` is optional. The OAuth request always includes
  `read_orders`, `read_customers`, and `write_discounts` in addition to any
  configured comma-separated scopes.

The Shopify connect endpoints require a current access JWT. If
`POST /api/v1/shopify/start` logs `TokenExpiredError` / `jwt expired`, the
request was rejected before OAuth began; refresh the user's session or sign in
again before retrying. Callback failures now return a stage and reference ID.
Use that reference to correlate `shopify_callback_stage`,
`shopify_callback_failed`, and token-exchange events in the backend logs. These
events intentionally omit the authorization code, HMAC, state cookie, and
access token.
- `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, and
  `SENDGRID_WEBHOOK_VERIFICATION_KEY`.
- `BETA_AUTOMATION_KILL_SWITCH=true` for the initial deployment.
- `REDIS_URL`, or the existing `REDIS_HOST` configuration, is required before
  the global beta action switch is deliberately set to `false`.

Optional services retain their existing Paystack, Cloudinary, WooCommerce,
logging, and scheduler interval variables. Redis remains optional only while
real beta actions are globally disabled or for a single-process local setup.

## Database migrations

Create migrations only during development after reviewing the generated SQL.
Apply committed migrations in deployment with:

```powershell
npm run migrate:deploy
```

`npm start` runs this command automatically through the `prestart` hook. Prisma
records applied migrations in `_prisma_migrations`, so a successful migration
is not replayed on later starts. A migration failure stops the Backend before it
accepts traffic.

The cart-recovery migration adds nullable
`abandoned_carts.recovery_url` and the non-unique
`idx_abandoned_carts_store_external` lookup index. It does not delete or rename
existing data.

The zero-touch automation migration enables pgvector and adds merchant-memory
embeddings, a durable embedding queue, model lifecycle runs, version-specific
live metrics, and durable automation job state. Its trigger backfills active
memories and keeps later changes synchronized. Backend startup applies both
migrations before workers start.

For local schema inspection after configuration:

```powershell
npm run prisma -- studio
```

## Start and verify

```powershell
npm run dev
```

- `GET /health` verifies process liveness.
- `GET /ready` returns `200` only when PostgreSQL and the allowed Python model
  release are ready. If the global beta action switch is open, it also requires
  all Shopify/SendGrid action configuration and a connected shared Redis.
- `/ready` reports only missing environment-variable names, never their values.
- Before enabling real recovery actions, configure one approved store through
  `PUT /api/v1/settings/beta-automation/:storeId`, verify consent and caps, and
  deliberately set `BETA_AUTOMATION_KILL_SWITCH=false`. Any other value,
  including an unset value, keeps provider actions disabled.

## Dependency audit status

`npm audit --omit=dev` currently reports three high findings from the Prisma
deployment CLI's `@prisma/config` dependency on `deepmerge-ts`. npm proposes a
breaking Prisma downgrade as its automatic fix. Do not run `npm audit fix
--force`; review a compatible Prisma release or a tested CLI-only mitigation
before changing this pinned migration toolchain.
