-- ============================================================================
-- u-flow — full Postgres schema for a brand-new, completely empty database
-- (e.g. a fresh Supabase project). Equivalent to running
-- db/migrations/0001_init.sql followed by db/migrations/0002_writeback_support.sql
-- in order, except every column each migration added is folded directly into
-- its table's CREATE TABLE below instead of a separate ALTER TABLE — there is
-- no existing data here to migrate, so there's nothing to preserve by keeping
-- the two migrations as separate steps.
--
-- Run once, in full, against the empty database:
--   psql "$DATABASE_URL" -f db/schema-fresh.sql
-- (or paste the whole file into Supabase's SQL Editor and run it)
--
-- Do NOT also run db/migrations/0001_init.sql / 0002_writeback_support.sql
-- afterwards — this file already creates everything both of those do.
--
-- No seed data is included on purpose: server/lib.ts's readUsersPg already
-- auto-creates one throwaway account per role (admin/Admin#2026,
-- manager1/Manager#2026, staff1/Staff#2026, checker1/Checker#2026,
-- picker1/Picker#2026, driver1/Driver#2026) the moment anything reads the
-- `users` table for the first time and finds it empty — right after this
-- schema is applied, just opening the app's login page and logging in as
-- admin/Admin#2026 is enough; nothing needs to be inserted here by hand.
-- Rotate/replace those passwords before relying on this for anything beyond
-- a first smoke test.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- customers — keyed by phone number (src/data/sources/csMaster.ts / CS Master
-- tab). name_from_unii/lat_from_unii/lng_from_unii/address_from_unii mirror
-- whatever Unii last reported for that phone; the *_override columns hold a
-- staff correction on top (e.g. a manually-fixed map pin), which always wins
-- over the raw Unii value when both are present.
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  phone             TEXT PRIMARY KEY,
  name_from_unii    TEXT NOT NULL DEFAULT '',
  name_override     TEXT,
  lat_from_unii     NUMERIC,
  lng_from_unii     NUMERIC,
  lat_override      NUMERIC,
  lng_override      NUMERIC,
  address_from_unii TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sku_master — product catalog (src/data/sources/skuSheet.ts / SKU Master
-- tab). sku_id can repeat across packaging-variant rows (same catalog SKU,
-- different pack size), so it is NOT the primary key.
-- ---------------------------------------------------------------------------
CREATE TABLE sku_master (
  id         BIGSERIAL PRIMARY KEY,
  sku_id     TEXT NOT NULL DEFAULT '',
  barcode    TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  unit       TEXT NOT NULL DEFAULT '',
  stock      NUMERIC NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  location   TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sku_master_sku_id ON sku_master (sku_id);

-- ---------------------------------------------------------------------------
-- promotions — โปรโมชั่น tab (src/data/sources/promotionsSheet.ts,
-- server/lib.ts handleUpsertPromotion). Matched/deduplicated by SKU, so `id`
-- = the SKU itself. term_text (free-text "Promotion Term") is the single
-- source of truth — tiers/per-packaging-unit prices are parsed from it at
-- read time, not stored structured here.
-- ---------------------------------------------------------------------------
CREATE TABLE promotions (
  id               TEXT PRIMARY KEY, -- = sku
  sku              TEXT NOT NULL,
  product_name     TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'Active', -- verbatim sheet text (e.g. Active/Inactive), not a fixed enum
  term_text        TEXT NOT NULL DEFAULT '',
  start_date       DATE,
  end_date         DATE,
  period_days      INTEGER,
  promotion_price  NUMERIC,
  box_price        NUMERIC,
  single_price     NUMERIC,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- batch_routes — Batch Route history (src/data/batchRoutes.ts). `id` doubles
-- as the human-visible batch code. Order membership is normalized onto
-- orders.batch_route_id below rather than a stored array. cancelled_order_uids
-- snapshots which orders a CANCELLED batch used to contain (its live
-- membership gets cleared for re-planning, so without this the history would
-- lose that record) — NULL for every batch that's never been cancelled.
-- "ยอดขายรวม" (total sales) is computed live via the batch_route_totals view
-- below, not cached here.
-- ---------------------------------------------------------------------------
CREATE TABLE batch_routes (
  id                    TEXT PRIMARY KEY,
  vehicle_id            TEXT NOT NULL DEFAULT '',
  vehicle_name          TEXT NOT NULL DEFAULT '',
  delivery_date         DATE NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            TEXT NOT NULL DEFAULT '',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by            TEXT NOT NULL DEFAULT '',
  locked                BOOLEAN NOT NULL DEFAULT false,
  cod_closed            BOOLEAN NOT NULL DEFAULT false,
  cod_closed_at         TIMESTAMPTZ,
  cod_closed_by         TEXT NOT NULL DEFAULT '',
  cancelled             BOOLEAN NOT NULL DEFAULT false,
  cancelled_at          TIMESTAMPTZ,
  cancelled_by          TEXT NOT NULL DEFAULT '',
  cancelled_order_uids  TEXT[]
);
CREATE INDEX idx_batch_routes_delivery_date ON batch_routes (delivery_date);

-- ---------------------------------------------------------------------------
-- orders — staff-entered data per order (src/data/types.ts's StaffOrderInfo,
-- the "คำสั่งซื้อ VS" tab). Raw Unii import fields (customer name/amount/item
-- count/raw status/timestamps) are read live from Unii instead, NOT stored
-- here (see server/unii.ts) — this table is only what staff enter through
-- this app itself. stop_sequence carries the Planner's drag-and-drop stop
-- ordering within a vehicle's batch (meaningful only while batch_route_id is
-- set); delivery_issue_at is when delivery_issue (operational status) was
-- last set.
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  order_uid           TEXT PRIMARY KEY,
  customer_phone      TEXT REFERENCES customers (phone),
  route               TEXT NOT NULL DEFAULT '', -- courier/vehicle route stamp once assigned; '' until then
  batch_route_id      TEXT REFERENCES batch_routes (id),
  delivery_date       DATE, -- StaffOrderInfo.plannedDeliveryDate ("วันที่จะจัดส่ง")
  note                TEXT NOT NULL DEFAULT '',
  needs_tax_invoice   BOOLEAN, -- NULL = staff never overrode it (falls back to Unii's own field on the import side)
  promotion_id        TEXT REFERENCES promotions (id),
  delivery_issue      TEXT NOT NULL DEFAULT '', -- operational status incl. ส่งไม่สำเร็จ/ส่งสำเร็จ/กำลังจัดส่ง
  delivery_issue_note TEXT NOT NULL DEFAULT '',
  delivery_issue_at   TIMESTAMPTZ,
  assigned_driver     TEXT NOT NULL DEFAULT '',
  assigned_at         TIMESTAMPTZ,
  stop_sequence       INTEGER,
  archived            BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_customer_phone ON orders (customer_phone);
CREATE INDEX idx_orders_batch_route_id ON orders (batch_route_id);
CREATE INDEX idx_orders_delivery_date ON orders (delivery_date);
CREATE INDEX idx_orders_batch_route_stop_sequence ON orders (batch_route_id, stop_sequence);

-- ---------------------------------------------------------------------------
-- order_line_items — per-line SKU/qty/price for an order (the "SKU Detail"
-- tab). Underlies promotion usage stats (tracked per line item via promo_sku,
-- not per order), batch-picking's merged SKU quantities, and per-order
-- amounts generally. orders.promotion_id is a simplified order-level summary
-- column; promo_sku here is the real, per-line source of truth.
-- ---------------------------------------------------------------------------
CREATE TABLE order_line_items (
  id           BIGSERIAL PRIMARY KEY,
  order_uid    TEXT NOT NULL REFERENCES orders (order_uid) ON DELETE CASCADE,
  line_no      TEXT NOT NULL DEFAULT '',
  sku          TEXT NOT NULL,
  product_name TEXT NOT NULL DEFAULT '',
  unit         TEXT NOT NULL DEFAULT '',
  qty          NUMERIC NOT NULL DEFAULT 0,
  unit_price   NUMERIC NOT NULL DEFAULT 0,
  discount     NUMERIC NOT NULL DEFAULT 0,
  line_total   NUMERIC NOT NULL DEFAULT 0,
  promo_sku    TEXT REFERENCES promotions (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_line_items_order_uid ON order_line_items (order_uid);
CREATE INDEX idx_order_line_items_promo_sku ON order_line_items (promo_sku);

-- ---------------------------------------------------------------------------
-- users — RBAC (server/lib.ts). password_hash format is scrypt
-- "salt:hashHex" (server/lib.ts hashPassword) — never store a plaintext
-- password here. See the file-header note above: this table auto-seeds one
-- throwaway account per role the first time it's read empty, so nothing
-- needs to be inserted manually after running this file.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  username          TEXT PRIMARY KEY,
  password_hash     TEXT NOT NULL,
  role              TEXT NOT NULL CHECK (role IN ('administrator', 'manager', 'admin_staff', 'checker', 'picker', 'driver')),
  active            BOOLEAN NOT NULL DEFAULT true,
  driver_vehicle_id TEXT NOT NULL DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- activity_log — audit trail (src/data/activityLog.ts). `actor` (not `user`
-- — a reserved word in SQL) holds the username. order_uid is deliberately
-- NOT a foreign key: a log entry must never fail to insert because the
-- order it references was since archived/removed, and some entries aren't
-- order-related at all.
-- ---------------------------------------------------------------------------
CREATE TABLE activity_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor      TEXT NOT NULL DEFAULT '',
  action     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  order_uid  TEXT
);
CREATE INDEX idx_activity_log_at ON activity_log (at DESC);
CREATE INDEX idx_activity_log_order_uid ON activity_log (order_uid);

-- ---------------------------------------------------------------------------
-- goods_receiving / goods_receiving_lines — src/data/receiving.ts. One
-- ReceivingRecord has many ReceivingLines (parent/child), not a single flat
-- table.
-- ---------------------------------------------------------------------------
CREATE TABLE goods_receiving (
  id            TEXT PRIMARY KEY,
  supplier      TEXT NOT NULL DEFAULT '',
  bill_no       TEXT NOT NULL DEFAULT '',
  received_date DATE,
  recorded_by   TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE goods_receiving_lines (
  id              BIGSERIAL PRIMARY KEY,
  receiving_id    TEXT NOT NULL REFERENCES goods_receiving (id) ON DELETE CASCADE,
  sku_id          TEXT NOT NULL DEFAULT '',
  unii_name       TEXT NOT NULL DEFAULT '',
  bill_name       TEXT NOT NULL DEFAULT '',
  bill_barcode    TEXT NOT NULL DEFAULT '',
  unit            TEXT NOT NULL DEFAULT '',
  bill_qty        NUMERIC NOT NULL DEFAULT 0,
  actual_qty      NUMERIC NOT NULL DEFAULT 0,
  unit_price      NUMERIC NOT NULL DEFAULT 0,
  discount        NUMERIC NOT NULL DEFAULT 0,
  discount_mode   TEXT NOT NULL DEFAULT 'baht' CHECK (discount_mode IN ('baht', 'percent')),
  line_type       TEXT NOT NULL DEFAULT 'ค่าสินค้า' CHECK (line_type IN ('ค่าสินค้า', 'ค่าขนส่ง', 'ส่วนลด')),
  note            TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_goods_receiving_lines_receiving_id ON goods_receiving_lines (receiving_id);

-- ---------------------------------------------------------------------------
-- batch_picking / batch_picking_orders / batch_picking_picks —
-- src/data/pickLots.ts. Order membership and merged SKU quantities are
-- joined live against orders/order_line_items at read time rather than
-- cached — only genuinely-independent state (which SKUs have been physically
-- checked off, and whether an order's status write-back after close is still
-- pending) has no other source, so those two get tables.
-- ---------------------------------------------------------------------------
CREATE TABLE batch_picking (
  id         TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed     BOOLEAN NOT NULL DEFAULT false,
  closed_by  TEXT NOT NULL DEFAULT '',
  closed_at  TIMESTAMPTZ
);

CREATE TABLE batch_picking_orders (
  lot_id               TEXT NOT NULL REFERENCES batch_picking (id) ON DELETE CASCADE,
  order_uid            TEXT NOT NULL REFERENCES orders (order_uid),
  has_no_lines         BOOLEAN NOT NULL DEFAULT false, -- mirrors PickLot.ordersWithNoLines
  status_sync_pending  BOOLEAN NOT NULL DEFAULT false, -- mirrors PickLot.statusSyncPending
  PRIMARY KEY (lot_id, order_uid)
);

CREATE TABLE batch_picking_picks (
  lot_id   TEXT NOT NULL REFERENCES batch_picking (id) ON DELETE CASCADE,
  sku      TEXT NOT NULL,
  picked   BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (lot_id, sku)
);

-- ---------------------------------------------------------------------------
-- delivery_bookings — driver stop-booking system (server/lib.ts). Surrogate
-- id (not order_uid as PK) because a rejected booking can be re-requested,
-- giving more than one row per order over time.
-- ---------------------------------------------------------------------------
CREATE TABLE delivery_bookings (
  id                BIGSERIAL PRIMARY KEY,
  order_uid         TEXT NOT NULL REFERENCES orders (order_uid),
  driver_username   TEXT NOT NULL,
  driver_vehicle_id TEXT NOT NULL DEFAULT '',
  status            TEXT NOT NULL,
  booked_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_by        TEXT NOT NULL DEFAULT '',
  decided_at        TIMESTAMPTZ,
  note              TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_delivery_bookings_order_uid ON delivery_bookings (order_uid);

-- ---------------------------------------------------------------------------
-- attachments — metadata only; files themselves stay on Google Drive
-- (src/data/sources/attachments.ts, src/config/drive.ts). Three scopes exist
-- (order / receiving / deliveryFailure), so entity_key is a generic string
-- rather than a strict order_uid foreign key.
-- ---------------------------------------------------------------------------
CREATE TABLE attachments (
  id             BIGSERIAL PRIMARY KEY,
  scope          TEXT NOT NULL CHECK (scope IN ('order', 'receiving', 'deliveryFailure')),
  entity_key     TEXT NOT NULL,
  drive_file_id  TEXT NOT NULL,
  name           TEXT NOT NULL DEFAULT '',
  mime_type      TEXT NOT NULL DEFAULT '',
  size_bytes     BIGINT NOT NULL DEFAULT 0,
  web_view_link  TEXT NOT NULL DEFAULT '',
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_attachments_scope_entity_key ON attachments (scope, entity_key);

-- ---------------------------------------------------------------------------
-- Convenience view: a batch route's total sales, computed live from its
-- orders' line items instead of a cached column. Satisfies "ยอดขายรวม"
-- without storing a number that could drift.
-- ---------------------------------------------------------------------------
CREATE VIEW batch_route_totals AS
SELECT
  br.id AS batch_route_id,
  COALESCE(SUM(oli.line_total), 0) AS total_sales
FROM batch_routes br
LEFT JOIN orders o ON o.batch_route_id = br.id
LEFT JOIN order_line_items oli ON oli.order_uid = o.order_uid
GROUP BY br.id;
