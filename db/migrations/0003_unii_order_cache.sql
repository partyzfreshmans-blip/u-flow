-- ============================================================================
-- Persisted mirror of Unii API order data, replacing the live-per-request
-- Unii call every page load used to make (see server/unii.ts's old
-- fetchApiImportOrdersFromUnii + its in-process, cold-start-fragile cache).
--
-- A scheduled sync (see server/lib.ts's handleSyncUniiOrders, triggered by
-- Vercel Cron — see vercel.json) is now the ONLY thing that ever calls Unii
-- live; every page read goes straight to this table instead, so a Unii
-- outage/timeout/rate-limit never blocks or errors a page load — the worst
-- case is showing data that's one sync interval old (see unii_sync_status
-- below for exactly how old).
--
-- Upsert-only, never pruned: fetchAllUniiOrders' pagination has a time
-- budget and can legitimately stop early on a slow/large response, so a
-- sync that returns fewer orders than last time must never be treated as
-- "Unii doesn't have these anymore" and delete rows — this table only ever
-- grows or updates in place, same principle as customers/batch_routes
-- elsewhere in this schema.
-- ============================================================================
CREATE TABLE unii_order_cache (
  order_uid           TEXT PRIMARY KEY,
  no                  TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT '',
  payment_type        TEXT NOT NULL DEFAULT '',
  paid                TEXT NOT NULL DEFAULT '',
  item_count          INTEGER NOT NULL DEFAULT 0,
  total_amount        NUMERIC NOT NULL DEFAULT 0,
  customer            TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  address             TEXT NOT NULL DEFAULT '',
  district            TEXT NOT NULL DEFAULT '',
  province            TEXT NOT NULL DEFAULT '',
  -- ordered_at/delivered_at/completed_at/unii_updated_at are Unii's own raw
  -- text for these fields (see src/data/types.ts's ApiImportOrder — never
  -- parsed/reformatted server-side, same as before this table existed), not
  -- guaranteed to be one consistent date format — kept as TEXT rather than
  -- TIMESTAMPTZ so a sync never fails on a value Postgres can't parse as a
  -- timestamp.
  ordered_at          TEXT NOT NULL DEFAULT '',
  delivered_at        TEXT NOT NULL DEFAULT '',
  completed_at        TEXT NOT NULL DEFAULT '',
  wants_tax_invoice   TEXT NOT NULL DEFAULT '',
  unii_updated_at     TEXT NOT NULL DEFAULT '',
  lat                 NUMERIC,
  lng                 NUMERIC,
  distance_from_wh_km NUMERIC,
  wh_lat              NUMERIC,
  wh_lng              NUMERIC,
  -- The complete object exactly as Unii's API returned it (ApiImportOrder.raw)
  -- — same "nothing is ever silently dropped" guarantee server/unii.ts's own
  -- mapping already keeps in memory, now persisted too.
  raw                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- When THIS row was last written by a successful sync — distinct from
  -- unii_updated_at (Unii's own claim about when the order changed).
  synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_unii_order_cache_phone ON unii_order_cache (phone);
CREATE INDEX idx_unii_order_cache_synced_at ON unii_order_cache (synced_at);

-- ---------------------------------------------------------------------------
-- Single-row status table for the sync job itself — lets a page read
-- distinguish "cache is fresh" from "cache is however old because the last
-- sync attempt failed" without that failure ever surfacing as a page error.
-- last_error is cleared back to NULL on the next successful sync, so it
-- never lingers as a false alarm about a since-resolved problem.
-- ---------------------------------------------------------------------------
CREATE TABLE unii_sync_status (
  id              TEXT PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error      TEXT,
  row_count       INTEGER NOT NULL DEFAULT 0
);
INSERT INTO unii_sync_status (id) VALUES ('singleton');
