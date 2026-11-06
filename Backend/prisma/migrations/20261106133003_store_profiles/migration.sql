-- Store identity and domains. Non-destructive; additive tables.
-- RLS enabled; zero policies; service-role only.

CREATE TABLE IF NOT EXISTS "store_profiles" (
  "store_id"               uuid PRIMARY KEY REFERENCES "stores"("id") ON DELETE CASCADE,
  "shop_name"              varchar(500),
  "myshopify_domain"       varchar(255),
  "primary_domain_host"    varchar(255),
  "primary_domain_url"     text,
  "primary_domain_ssl"     boolean,
  "email"                  varchar(320),
  "iana_timezone"          varchar(64),
  "currency_code"          varchar(3),
  "country_code"           varchar(3),
  "country_name"           varchar(120),
  "city"                   varchar(120),
  "zip"                    varchar(32),
  "plan_display_name"      varchar(190),
  "plan_partner_development" boolean,
  "plan_shopify_plus"      boolean,
  "synced_at"              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "store_profiles_store_key" UNIQUE ("store_id")
);
ALTER TABLE "store_profiles" ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS "store_domains" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "store_id"    uuid NOT NULL REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "host"        varchar(255) NOT NULL,
  "url"         text,
  "kind"        varchar(32) NOT NULL,
  "ssl_enabled" boolean,
  "synced_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "store_domains_store_host_key" UNIQUE ("store_id", "host")
);
CREATE INDEX IF NOT EXISTS "idx_store_domains_store" ON "store_domains" ("store_id");
ALTER TABLE "store_domains" ENABLE ROW LEVEL SECURITY;
