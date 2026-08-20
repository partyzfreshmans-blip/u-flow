// A "Batch Route" is a permanent record of one vehicle's confirmed delivery
// run for a given day — created by the "Assign" step on the Planner page so
// a completed run can be audited later (which orders, how much COD, any
// delivery problems) without digging through the live/editable route plan.
// Kept in localStorage like zones/vehicles/routePlan/pickLots — this app has
// no backend table for it, and the delivery-day snapshot only ever needs to
// survive a reload on the same machine, same as every other planner record.

export interface BatchRoute {
  id: string;
  vehicleId: string;
  vehicleName: string;
  /** ISO YYYY-MM-DD — the planner day this batch was assigned for. */
  deliveryDate: string;
  /** Locked delivery sequence — the source of truth for this batch's
   * contents once assigned; kept in sync with routePlan[vehicleId] only
   * while explicitly unlocked for editing (see PlannerPage). */
  orderNos: string[];
  createdAt: string; // ISO timestamp
  createdBy: string; // username
  updatedAt: string;
  updatedBy: string;
  /** true = sequence/membership locked; edits require unlocking first. */
  locked: boolean;
  /** Set by the COD Clearing page's "ปิดยอดรอบนี้ (batch)" button — one
   * batch route is exactly one COD clearing round. */
  codClosed: boolean;
  codClosedAt: string; // ISO timestamp, '' until closed
  codClosedBy: string; // username, '' until closed
  /** Set by "ยกเลิก Batch Route" (mistaken assignment) — never deletes the
   * record, so Batch Route History keeps the audit trail. Only allowed while
   * no order in the batch has actually been delivered yet (see
   * canCancelBatchRoute + the delivered-count check in derive.ts). */
  cancelled: boolean;
  cancelledAt: string; // ISO timestamp, '' until cancelled
  cancelledBy: string; // username, '' until cancelled
}

const STORAGE_KEY = 'warehouse-ops.batchRoutes.v1';

/** Older persisted batches predate the codClosed/codClosedAt/codClosedBy
 * fields — default them to "never closed" rather than leaving them
 * undefined, so every reader can rely on the fields always being present. */
export function normalizeBatchRoute(b: BatchRoute): BatchRoute {
  return {
    ...b,
    codClosed: b.codClosed ?? false,
    codClosedAt: b.codClosedAt ?? '',
    codClosedBy: b.codClosedBy ?? '',
    cancelled: b.cancelled ?? false,
    cancelledAt: b.cancelledAt ?? '',
    cancelledBy: b.cancelledBy ?? '',
  };
}

export function dedupeBatchRoutes(list: BatchRoute[]): BatchRoute[] {
  const byId = new Map<string, BatchRoute>();
  for (const item of list) {
    if (!item || !item.id) continue;
    const normalized = normalizeBatchRoute(item);
    const existing = byId.get(normalized.id);
    if (!existing) {
      byId.set(normalized.id, normalized);
    } else {
      if (normalized.orderNos.length > 0 && existing.orderNos.length === 0) {
        byId.set(normalized.id, normalized);
      } else if (normalized.orderNos.length === 0 && existing.orderNos.length > 0) {
        byId.set(normalized.id, {
          ...existing,
          codClosed: normalized.codClosed || existing.codClosed,
          updatedAt: normalized.updatedAt > existing.updatedAt ? normalized.updatedAt : existing.updatedAt,
        });
      } else {
        const itemTime = normalized.updatedAt || normalized.createdAt || '';
        const existTime = existing.updatedAt || existing.createdAt || '';
        if (itemTime >= existTime) {
          byId.set(normalized.id, normalized);
        }
      }
    }
  }
  return Array.from(byId.values());
}

export function loadBatchRoutes(): BatchRoute[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? dedupeBatchRoutes((parsed as BatchRoute[]).map(normalizeBatchRoute)) : [];
  } catch {
    return [];
  }
}

export function saveBatchRoutes(list: BatchRoute[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dedupeBatchRoutes(list)));
  } catch {
    /* storage unavailable — batches stay in memory for this session */
  }
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "2026-07-26" -> "26JUL". */
export function batchDatePart(deliveryDateIso: string): string {
  const [y, m, d] = deliveryDateIso.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return '';
  return `${String(d).padStart(2, '0')}${MONTH_ABBR[m - 1]}`;
}

/** Next running batch code for this date+zone, e.g. "26JUL-A1", then
 * "26JUL-A2" if a second batch is assigned for vehicle A the same day. Reads
 * the running number back out of existing ids (rather than just counting
 * matches) so it stays correct even if an older batch is ever removed. */
export function nextBatchId(existing: BatchRoute[], deliveryDate: string, loadPrefix: string): string {
  const datePart = batchDatePart(deliveryDate);
  const prefix = (loadPrefix || 'X').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'X';
  const re = new RegExp(`^${datePart}-${prefix}(\\d+)$`);
  let maxRun = 0;
  for (const b of existing) {
    const m = re.exec(b.id);
    if (m) maxRun = Math.max(maxRun, Number(m[1]));
  }
  return `${datePart}-${prefix}${maxRun + 1}`;
}
