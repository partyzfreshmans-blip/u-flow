// Timestamp of the last time every Google Sheet source successfully
// refreshed (manual "Sync" button, or one of the app's own fetch-on-mount
// loads) — persisted so the header's "อัปเดตล่าสุด" text survives a reload
// instead of resetting to "just now" every time.

const LAST_SYNC_KEY = 'warehouse-ops.lastSyncAt.v1';

export function loadLastSyncAt(): number | null {
  try {
    const raw = localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function saveLastSyncAt(ts: number): void {
  try {
    localStorage.setItem(LAST_SYNC_KEY, String(ts));
  } catch {
    /* storage unavailable (private mode) — value stays in memory for this session */
  }
}
