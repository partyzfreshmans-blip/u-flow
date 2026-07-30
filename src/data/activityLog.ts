// User-action audit trail — lives in Postgres's `activity_log` table now
// (see server/lib.ts's handleListActivityLog/handleAppendActivityLog),
// shared across every device/session instead of scattered per-browser
// localStorage. A local cache is still kept (same "local-first, instant on
// load" pattern batchRoutes.ts uses) so the page has something to show the
// moment it mounts, before the network fetch resolves.
import { authHeaders, type Session } from './session';

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

/** Local cache only — read at mount for instant display; overwritten by the
 * next successful fetchActivityLog. */
export function loadActivityLogCache(): ActivityLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ActivityLogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveActivityLogCache(log: ActivityLogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log.slice(0, MAX_ENTRIES)));
  } catch {
    /* storage unavailable (private mode) — cache stays in memory for this session */
  }
}

/** Every entry, newest first — from Postgres. */
export async function fetchActivityLog(session: Session | null): Promise<ActivityLogEntry[]> {
  let res: Response;
  try {
    res = await fetch('/api/ops/activity-log', { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `โหลด Activity Log ไม่สำเร็จ (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { entries?: ActivityLogEntry[] };
  const entries = Array.isArray(body.entries) ? body.entries : [];
  saveActivityLogCache(entries);
  return entries;
}

/** Prepends one entry locally (optimistic, instant UI feedback) and fires a
 * best-effort write to Postgres in the background — callers don't await the
 * network write, matching every other "local-first" action in this app
 * (see store.ts's persistBatchRoutes). The id/at here are client-generated
 * and never reconciled with the server's own row id — nothing else in the
 * app references a log entry by id, so that's fine. */
export function appendActivityLog(existing: ActivityLogEntry[], entry: Omit<ActivityLogEntry, 'id' | 'at'>): ActivityLogEntry[] {
  const full: ActivityLogEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now() };
  const next = [full, ...existing].slice(0, MAX_ENTRIES);
  saveActivityLogCache(next);
  return next;
}

export async function postActivityLog(session: Session | null, entry: { action: string; detail: string; orderNo?: string }): Promise<void> {
  const res = await fetch('/api/ops/activity-log/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify(entry),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `บันทึก Activity Log ไม่สำเร็จ (HTTP ${res.status})`);
  }
}
