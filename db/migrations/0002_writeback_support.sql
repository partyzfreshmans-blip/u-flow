-- ============================================================================
-- Support columns for moving write-back features off Google Sheets onto
-- Postgres (see the "write-back migration" work following 0001_init.sql).
-- Purely additive — safe to run against a database that already has real
-- data from 0001_init.sql / the data-migration script.
-- ============================================================================

-- StaffOrderInfo's "เวลาที่บันทึกสถานะ" column had no equivalent timestamp in
-- 0001_init.sql — orders.delivery_issue (operational status text) needs a
-- paired "when was this last set" the same way the Sheet did, for Driver
-- View / delivery-outcome history to keep showing it.
ALTER TABLE orders ADD COLUMN delivery_issue_at TIMESTAMPTZ;

-- Batch membership is normalized onto orders.batch_route_id (no stored
-- orderNos array — see 0001_init.sql's batch_routes comment). That's correct
-- for a LIVE batch, but a CANCELLED batch's orders get their batch_route_id
-- cleared (freeing them for re-planning) — without a snapshot, Batch Route
-- History would lose the record of what a cancelled batch used to contain.
-- Populated only at the moment a batch is cancelled; NULL for every batch
-- that's never been cancelled (its membership is always read live instead).
ALTER TABLE batch_routes ADD COLUMN cancelled_order_uids TEXT[];

-- The Planner's drag-and-drop stop ordering within a vehicle's batch was
-- previously carried implicitly by array position in the Sheet's orderNos
-- cell — normalizing membership onto orders.batch_route_id (a foreign key)
-- drops that ordering unless it's captured explicitly. Meaningful only while
-- batch_route_id is set; NULL once an order leaves its batch.
ALTER TABLE orders ADD COLUMN stop_sequence INTEGER;
CREATE INDEX idx_orders_batch_route_stop_sequence ON orders (batch_route_id, stop_sequence);
