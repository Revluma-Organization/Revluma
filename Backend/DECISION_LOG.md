# Decision Log - Multi-Platform eCommerce Integration

## DATE        DECISION                                          RATIONALE
------------  ------------------------------------------------  --------------------------------------------------
2026-04-18    Used HKDF for per-store key derivation           Avoids key management complexity of storing individual keys; master rotation invalidates all (acceptable tradeoff)
2026-04-18    AsyncGenerator over Promise<T[]> for fetchers   Prevents OOM on large stores; forces streaming consumption pattern upstream
2026-04-18    Separate BullMQ queues per concern                Prevents priority inversion; enables independent scaling and retry policies
2026-04-18    Nock over live API calls in tests                CI reliability; platform APIs are not always available; test behavior not contracts
2026-04-18    WooCommerce pixel over plugin requirement        Lower merchant friction; plugin requirement would reduce conversion on onboarding
2026-04-18    Added 15-min grace period for WooCommerce        WooCommerce pixel tracking has inherent delay; compensates for timing uncertainty
2026-04-18    Used Platform enum instead of string             Type safety; Prisma enum for DB constraints, prevents invalid values
2026-04-18    Created separate PlatformCredential model        Separates encryption concerns from store config; allows credential rotation without affecting store
2026-04-18    Added webhook event deduplication                Prevents duplicate processing; uses externalEventId when available, falls back to storeId
2026-04-18    Single PrismaClient instance per request         Prevents connection pool exhaustion; each job creates/disposes own instance