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
- `PYTHON_ALLOWED_MODEL_STATUSES=beta_ready` for controlled beta. Production
  model deployments should use `ready`.

Shopify and messaging:

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_REDIRECT_URI`, and
  `SHOPIFY_TOKEN_ENCRYPTION_KEY`.
- `SHOPIFY_API_VERSION` is optional; the service has a reviewed default.
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

The current cart-recovery migration adds nullable
`abandoned_carts.recovery_url` and the non-unique
`idx_abandoned_carts_store_external` lookup index. It does not delete or rename
existing data.

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
