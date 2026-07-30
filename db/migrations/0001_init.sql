-- ============================================================================
-- u-flow Postgres schema — Phase 1 (schema + connection setup only)
--
-- This migration ONLY creates tables. Nothing in the running app reads from
-- or writes to this database yet — Google Sheets remains the live source of
-- truth until a future migration phase copies data over and cuts the app's
-- read/write paths over table by table. See db/README.md for the full
-- rationale, field-by-field source mapping, and deliberate deviations from a
-- literal 1:1 port of the Sheets/localStorage shapes.
--
-- Run with:  psql "$DATABASE_URL" -f db/migrations/0001_init.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- customers — keyed by phone number (src/data/sources/csMaster.ts / CS Master
-- tab). The sheet today stores only ONE lat/lng pair per customer (the
-- override, when staff have corrected Unii's geocoding) — the *raw* Unii
-- coordinate actually lives on each order row (ApiImportOrder.lat/lng), not
-- on the customer. Splitting raw vs. override into two persisted pairs here
-- is a genuine normalization improvement the user asked for; a future data
-- migration would backfill lat_from_unii/lng_from_unii from the first known
-- order coordinate seen for that phone number.
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
-- tab). sku_id can repeat across packaging-variant rows in the source sheet
-- (same catalog SKU, different pack size), so it is NOT the primary key —
-- matches how src/data/types.ts's Sku.id already disambiguates with a row
-- index rather than trusting sku_id alone.
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
-- server/lib.ts handleUpsertPromotion). Matched/deduplicated by SKU today
-- (a duplicate SKU is rejected as a 409 conflict), so `id` = the SKU itself.
--
-- Deliberately NOT split into promo_tiers / promo_pack_units child tables:
-- in the current app, `term_text` (the sheet's free-text "Promotion Term"
-- column) is the single source of truth, and stepped-quantity tiers /
-- per-packaging-unit prices are *parsed from it at read time*
-- (parseTiers/parsePackUnits in promotionsSheet.ts) — nothing already
-- persists them structured. Keeping that same shape here avoids inventing
-- storage for data the app doesn't actually store today; a future phase can
-- port the parsing logic unchanged.
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
-- batch_routes — Batch Route history (src/data/batchRoutes.ts, server/lib.ts
-- BATCH_ROUTES_HEADER). `id` doubles as the human-visible batch code.
--
-- orderNos (a JSON/CSV blob in one sheet cell today) is normalized away —
-- membership is expressed the standard relational way, via orders.batch_route_id.
-- "ยอดขายรวม" (total sales) is likewise NOT a stored column: today it's
-- computed on the fly from order line items, and this schema keeps that
-- live-computation approach (see the batch_route_totals view below) rather
-- than caching a number that could drift from its source — the same
-- live-read/runtime-join principle the app's own order architecture already
-- follows (src/data/routeOrders.ts's joinRouteOrders).
-- ---------------------------------------------------------------------------
CREATE TABLE batch_routes (
  id             TEXT PRIMARY KEY,
  vehicle_id     TEXT NOT NULL DEFAULT '',
  vehicle_name   TEXT NOT NULL DEFAULT '',
  delivery_date  DATE NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     TEXT NOT NULL DEFAULT '',
  locked         BOOLEAN NOT NULL DEFAULT false,
  cod_closed     BOOLEAN NOT NULL DEFAULT false,
  cod_closed_at  TIMESTAMPTZ,
  cod_closed_by  TEXT NOT NULL DEFAULT '',
  cancelled      BOOLEAN NOT NULL DEFAULT false,
  cancelled_at   TIMESTAMPTZ,
  cancelled_by   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_batch_routes_delivery_date ON batch_routes (delivery_date);

-- ---------------------------------------------------------------------------
-- orders — staff-entered data per order (src/data/types.ts's StaffOrderInfo,
-- the "คำสั่งซื้อ VS" tab). Raw Unii import fields (customer name/amount/
-- item count/raw status/timestamps — ApiImportOrder) are intentionally NOT
-- part of this table, mirroring the user's own description of this table as
-- staff-entered data. A future migration phase still needs a decision on
-- where ApiImportOrder's data lives (mirror table vs. keep reading it live
-- from Unii/Sheets) — flagged here, not resolved in this phase.
--
-- delivery_issue / delivery_issue_note extend the user's single
-- "delivery_issue" column to also carry the free-text note that
-- src/data/deliveryFailures.ts's DeliveryFailureRecord already tracks
-- separately from the reason — otherwise that note would have nowhere to
-- land.
-- ---------------------------------------------------------------------------
CREATE TABLE orders (
  order_uid          TEXT PRIMARY KEY,
  customer_phone     TEXT REFERENCES customers (phone),
  route              TEXT NOT NULL DEFAULT '', -- courier/vehicle route stamp once assigned; '' until then
  batch_route_id     TEXT REFERENCES batch_routes (id),
  delivery_date      DATE, -- StaffOrderInfo.plannedDeliveryDate ("วันที่จะจัดส่ง")
  note               TEXT NOT NULL DEFAULT '',
  needs_tax_invoice  BOOLEAN, -- NULL = staff never overrode it (falls back to Unii's own field on the import side)
  promotion_id       TEXT REFERENCES promotions (id),
  delivery_issue     TEXT NOT NULL DEFAULT '', -- operational status incl. ส่งไม่สำเร็จ/ส่งสำเร็จ/กำลังจัดส่ง
  delivery_issue_note TEXT NOT NULL DEFAULT '',
  assigned_driver    TEXT NOT NULL DEFAULT '',
  assigned_at        TIMESTAMPTZ,
  archived           BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_orders_customer_phone ON orders (customer_phone);
CREATE INDEX idx_orders_batch_route_id ON orders (batch_route_id);
CREATE INDEX idx_orders_delivery_date ON orders (delivery_date);

-- ---------------------------------------------------------------------------
-- order_line_items — NOT in the user's explicit table list, but added
-- because it underlies three features the "cover every feature that
-- actually exists" instruction does call for: promotion usage stats (today
-- tracked per LINE ITEM via OrderLineItem.promoSku, not per order — see
-- server/lib.ts's handleLinkPromo), batch-picking's merged SKU quantities,
-- and per-order amounts generally (the "SKU Detail" tab). Without this
-- table, none of those have anywhere to read line-level data from.
--
-- orders.promotion_id (the user's literal ask) is kept as a simplified
-- order-level summary column; promo_sku here is the real, per-line source
-- of truth matching current behavior.
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
-- users — existing RBAC (server/lib.ts USERS_HEADER + VALID_ROLES). password
-- hash format is scrypt "salt:hashHex" (server/lib.ts hashPassword) — stored
-- verbatim; hashing logic itself is unchanged in this phase.
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
-- activity_log — audit trail (src/data/activityLog.ts), currently
-- localStorage-only/browser-local. `actor` (not `user` — a reserved word in
-- SQL) holds the username. order_uid is deliberately NOT a foreign key: a
-- log entry must never fail to insert because the order it references was
-- since archived/removed, and some entries aren't order-related at all.
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
-- goods_receiving / goods_receiving_lines — src/data/receiving.ts. The real
-- feature is a parent/child structure (one ReceivingRecord has many
-- ReceivingLines), not the single flat table the outline's wording implied —
-- split into two tables to stay faithful to that shape.
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
-- src/data/pickLots.ts. Order membership and merged SKU quantities are kept
-- normalized (join against orders/order_line_items at read time) rather than
-- cached, again following the app's existing live-read/runtime-join
-- principle. Only genuinely-independent state — which SKUs have been
-- physically checked off, and whether an order's status write-back after
-- close is still pending — has no other source, so those two get tables.
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
-- delivery_bookings — driver stop-booking system (server/lib.ts
-- BOOKINGS_HEADER). Surrogate id (not order_uid as PK) because a rejected
-- booking can be re-requested, giving more than one row per order over time.
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
-- today (order / receiving / deliveryFailure), not just order-keyed as the
-- outline text implied, so entity_key is a generic string rather than a
-- strict order_uid foreign key — it holds an order_uid for 'order' and
-- 'deliveryFailure' scopes, and a receiving-record folder key for
-- 'receiving' (see driveFolderPath / receivingFolderKey).
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
-- orders' line items instead of a cached column (see batch_routes comment
-- above). Satisfies "ยอดขายรวม" without storing a number that could drift.
-- ---------------------------------------------------------------------------
CREATE VIEW batch_route_totals AS
SELECT
  br.id AS batch_route_id,
  COALESCE(SUM(oli.line_total), 0) AS total_sales
FROM batch_routes br
LEFT JOIN orders o ON o.batch_route_id = br.id
LEFT JOIN order_line_items oli ON oli.order_uid = o.order_uid
GROUP BY br.id;
