// Record of orders auto-detached from a Batch Route by the cross-day
// stuck-order detector (see derive.ts's ordersNeedingStuckBatchDetach and
// store.ts's autoDetachStuckOrder) — a driver never marked it delivered (or
// failed) before 23:59 of its own delivery date. Kept purely for the
// Planner's "ตกหล่นจากวันก่อนหน้า" badge on the now-unassigned order; the
// permanent record of the event itself lives in the Activity Log. Not
// actively cleared once the order is reassigned — it just stops being
// relevant once the order leaves the unassigned pool (see the badge's own
// "orderNo in stuckDetachments AND still unassigned" check), so a stale
// entry here is harmless.

export interface StuckDetachment {
  orderNo: string;
  fromBatchId: string;
  fromVehicleName: string;
  detectedAt: string; // ISO timestamp
}

export type StuckDetachmentIndex = Record<string, StuckDetachment>;

const STORAGE_KEY = 'warehouse-ops.stuckDetachments.v1';

export function loadStuckDetachments(): StuckDetachmentIndex {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as StuckDetachmentIndex) : {};
  } catch {
    return {};
  }
}

export function saveStuckDetachments(index: StuckDetachmentIndex): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    /* storage unavailable — record stays in memory for this session */
  }
}
