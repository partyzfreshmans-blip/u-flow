// User-action audit trail — kept entirely in this browser (localStorage),
// never written back to Google Sheets. Every entry is appended, never
// mutated, so the log itself can't be tampered with from the UI.

export interface ActivityLogEntry {
  id: string;
  at: number;
  user: string;
  /** Short Thai summary, e.g. "แก้ไขวันที่จัดส่ง". */
  action: string;
  /** Before → after detail, e.g. "จาก — → 26/07/2026". */
  detail: string;
  orderNo?: string;
}

const STORAGE_KEY = 'warehouse-ops.activityLog.v1';
const MAX_ENTRIES = 500;

export function loadActivityLog(): ActivityLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActivityLogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveActivityLog(log: ActivityLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage unavailable (private mode) — log stays in memory for this session */
  }
}

/** Appends one entry (newest first) and persists the trimmed result. */
export function appendActivityLog(existing: ActivityLogEntry[], entry: Omit<ActivityLogEntry, 'id' | 'at'>): ActivityLogEntry[] {
  const full: ActivityLogEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() };
  const next = [full, ...existing].slice(0, MAX_ENTRIES);
  saveActivityLog(next);
  return next;
}
