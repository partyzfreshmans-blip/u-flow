// Batch-picking lots: built by merging SKU Detail line items across a set of
// selected orders. Local state (localStorage, like zones/vehicles/
// routePlan) stays the source of truth for resuming an in-progress lot on
// THIS device — orderSummaries/lines are derived from live SKU Detail reads
// and were never persisted anywhere before, and reconstructing them from a
// bare server record for an arbitrary historical order set is out of scope
// this round (see db/README.md). What DOES move to Postgres (see
// server/lib.ts's handleListPickLots/handleSavePickLot/handleCancelPickLot):
// lot identity, order membership, and the picked/closed state itself — the
// three pieces that have no other source and are worth having centrally
// recorded (an administrator can see picking activity even if the picker's
// own browser data is cleared). Every mutation here also fires a best-effort
// background sync to Postgres (see store.ts), same "local-first" pattern
// batchRoutes.ts uses.
import { authHeaders, type Session } from './session';

export interface PickLotOrderSummary {
  orderNo: string;
  customer: string;
  itemCount: number;
  amount: number;
}

/** One merged SKU line in a lot, with enough of a per-order breakdown to
 * split correctly when packing separate boxes per order. */
export interface PickLotLine {
  sku: string;
  name: string;
  unit: string;
  totalQty: number;
  /** Storage/bin location — blank when the SKU Master sheet has no such
   * column for this SKU (it doesn't today; see src/data/sources/skuSheet.ts). */
  location: string;
  perOrder: { orderNo: string; customer: string; qty: number }[];
}

export interface PickLot {
  id: string;
  createdAt: string; // ISO timestamp
  orderNos: string[];
  orderSummaries: PickLotOrderSummary[];
  lines: PickLotLine[];
  /** sku -> picked. */
  picked: Record<string, boolean>;
  closed: boolean;
  /** Orders selected into this lot that had zero rows in SKU Detail — flagged
   * so the picker knows that order's items won't appear in the checklist,
   * rather than silently missing them. */
  ordersWithNoLines: string[];
  /** Order numbers whose post-close status write-back hasn't succeeded yet. */
  statusSyncPending: string[];
  /** Username that closed this lot — the "ผู้จัด" (packer) shown elsewhere.
   * '' for lots that predate this field or aren't closed yet. */
  closedBy: string;
}

const STORAGE_KEY = 'warehouse-ops.pickLots.v1';

export function loadPickLots(): PickLot[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PickLot[]) : [];
  } catch {
    return [];
  }
}

export function savePickLots(lots: PickLot[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lots));
  } catch {
    /* storage unavailable — lots stay in memory for this session */
  }
}

/** Best-effort background push of one lot's persistent fields (membership,
 * picked map, closed state) to Postgres — never awaited by callers that
 * shouldn't block on it (see store.ts), matching persistBatchRoutes. */
export async function syncPickLotToServer(session: Session | null, lot: PickLot): Promise<void> {
  const res = await fetch('/api/ops/batch-picking/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({
      id: lot.id,
      orderNos: lot.orderNos,
      ordersWithNoLines: lot.ordersWithNoLines,
      picked: lot.picked,
      closed: lot.closed,
      closedBy: lot.closedBy,
      statusSyncPending: lot.statusSyncPending,
    }),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `ซิงค์ล็อตหยิบสินค้าขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ${res.status})`);
  }
}

export async function cancelPickLotOnServer(session: Session | null, id: string): Promise<void> {
  const res = await fetch('/api/ops/batch-picking/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `ยกเลิกล็อตหยิบสินค้าบนเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ${res.status})`);
  }
}
