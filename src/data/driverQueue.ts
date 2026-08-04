// Offline outbox for the mobile driver view: stop outcomes recorded on the
// phone but not yet confirmed written to the real sheet. Persisted so a
// dropped connection (or a killed/reloaded browser tab) never loses a
// driver's tap — it just waits here until the next sync attempt succeeds.
//
// Failed deliveries are NOT here: they carry photo blobs, which don't fit
// localStorage's string-only quota, so they have their own IndexedDB queue
// (see src/data/failedDeliveryQueue.ts).

const QUEUE_KEY = 'warehouse-ops.driverSyncQueue.v1';

/** Marked "ส่งสำเร็จ" at the door. */
export interface DeliveredQueueItem {
  kind: 'delivered';
  orderNo: string;
}

/** Pushed to a later day ("เลื่อนส่ง") — carries the new delivery date, so
 * unlike a plain delivered mark it can't be represented by an orderNo alone.
 * Widening this queue's element type from a bare string is what lets
 * postponement queue offline on equal footing with delivery. */
export interface PostponedQueueItem {
  kind: 'postponed';
  orderNo: string;
  /** ISO YYYY-MM-DD the stop was moved to. */
  newDateIso: string;
}

export type DriverQueueItem = DeliveredQueueItem | PostponedQueueItem;

function isItem(x: unknown): x is DriverQueueItem {
  if (!x || typeof x !== 'object') return false;
  const o = x as { kind?: unknown; orderNo?: unknown; newDateIso?: unknown };
  if (typeof o.orderNo !== 'string' || o.orderNo === '') return false;
  if (o.kind === 'delivered') return true;
  return o.kind === 'postponed' && typeof o.newDateIso === 'string' && o.newDateIso !== '';
}

/** Reads the outbox, transparently upgrading the previous on-disk format (a
 * bare string[] of delivered orderNos) so a driver who is mid-shift when the
 * app updates doesn't silently lose already-queued taps. */
export function loadDriverQueue(): DriverQueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x): DriverQueueItem | null => {
        if (typeof x === 'string') return x ? { kind: 'delivered', orderNo: x } : null;
        return isItem(x) ? x : null;
      })
      .filter((x): x is DriverQueueItem => x !== null);
  } catch {
    return [];
  }
}

export function saveDriverQueue(queue: DriverQueueItem[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    /* storage unavailable — queue stays in memory for this session */
  }
}

/** Adds an item, replacing any earlier queued outcome for the same order —
 * the last thing the driver said about a stop is the only one worth sending. */
export function enqueueDriverItem(queue: DriverQueueItem[], item: DriverQueueItem): DriverQueueItem[] {
  return [...queue.filter((q) => q.orderNo !== item.orderNo), item];
}

// ---- last vehicle the driver view was opened on ----
// A real driver account is pinned to its own vehicle by the session, but an
// admin/manager previewing Driver View picks one by hand — remembering it
// means they aren't re-picking on every launch.
const LAST_VEHICLE_KEY = 'warehouse-ops.driverLastVehicle.v1';

export function loadLastDriverVehicle(): string | null {
  try {
    return localStorage.getItem(LAST_VEHICLE_KEY);
  } catch {
    return null;
  }
}

export function saveLastDriverVehicle(vehicleId: string | null): void {
  try {
    if (vehicleId) localStorage.setItem(LAST_VEHICLE_KEY, vehicleId);
    else localStorage.removeItem(LAST_VEHICLE_KEY);
  } catch {
    /* storage unavailable — the pick just won't survive this reload */
  }
}
