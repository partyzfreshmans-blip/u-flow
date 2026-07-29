// Pre-departure SKU checklist confirmation, per Batch Route — a driver ticks
// off (or bulk-confirms) that they've physically counted everything listed
// before leaving the warehouse. Local only, same as pick-lots/batchRoutes'
// own local-first pattern; the confirmation itself is what gets logged to
// the (also local) Activity Log, which is the actual audit trail.

export interface PreDepartureChecklistState {
  /** SKUs the driver has individually ticked. */
  checkedSkus: string[];
  /** Set once "ยืนยันเริ่มเดินทาง" is pressed, whether or not every SKU was
   * ticked first — records that the driver explicitly acknowledged the list
   * (complete or not) before leaving, not "physically confirmed 100%". */
  confirmedAt: string | null;
  confirmedBy: string;
}

export type PreDepartureChecklistIndex = Record<string, PreDepartureChecklistState>;

const STORAGE_KEY = 'warehouse-ops.preDepartureChecklist.v1';

export function loadPreDepartureChecklists(): PreDepartureChecklistIndex {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as PreDepartureChecklistIndex) : {};
  } catch {
    return {};
  }
}

export function savePreDepartureChecklists(index: PreDepartureChecklistIndex): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    /* storage unavailable — checklist state stays in memory for this session */
  }
}
