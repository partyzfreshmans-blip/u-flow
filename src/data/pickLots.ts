// Batch-picking lots: built by merging SKU Detail line items across a set of
// selected orders. Kept in localStorage (like zones/vehicles/routePlan) so an
// unclosed lot survives a reload and a picker can resume it.

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
