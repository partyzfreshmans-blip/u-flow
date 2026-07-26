// Offline outbox for the mobile driver view: orderNos marked "ส่งสำเร็จ"
// locally but not yet confirmed written to the real sheet. Persisted so a
// dropped connection (or a killed/reloaded browser tab) never loses a
// driver's "delivered" tap — it just waits here until the next sync attempt
// succeeds.

const QUEUE_KEY = 'warehouse-ops.driverSyncQueue.v1';

export function loadDriverQueue(): string[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveDriverQueue(queue: string[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* storage unavailable — queue stays in memory for this session */
  }
}
