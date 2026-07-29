// Offline queue for "ส่งไม่สำเร็จ" submissions that couldn't upload their
// photo(s) right away (no connection). Unlike driverSyncQueue (a plain
// orderNo string list — see src/data/driverQueue.ts), this has to carry the
// actual photo File/Blob data too, which doesn't fit localStorage's
// string-only quota — IndexedDB is the platform's own answer for persisting
// binary data across a reload, so this is a small dedicated store rather
// than trying to force it through the same localStorage helper.

const DB_NAME = 'warehouse-ops-failed-delivery-queue';
const DB_VERSION = 1;
const STORE_NAME = 'pending';

export interface FailedDeliveryQueueItem {
  orderNo: string;
  reason: string;
  note: string;
  photos: File[];
  queuedAt: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'orderNo' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('เปิดฐานข้อมูลออฟไลน์ไม่สำเร็จ'));
  });
}

export async function saveFailedDeliveryQueueItem(item: FailedDeliveryQueueItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('บันทึกคิวออฟไลน์ไม่สำเร็จ'));
  });
  db.close();
}

export async function removeFailedDeliveryQueueItem(orderNo: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(orderNo);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('ลบคิวออฟไลน์ไม่สำเร็จ'));
  });
  db.close();
}

export async function loadFailedDeliveryQueue(): Promise<FailedDeliveryQueueItem[]> {
  try {
    const db = await openDb();
    const items = await new Promise<FailedDeliveryQueueItem[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as FailedDeliveryQueueItem[]);
      req.onerror = () => reject(req.error ?? new Error('อ่านคิวออฟไลน์ไม่สำเร็จ'));
    });
    db.close();
    return items;
  } catch {
    // IndexedDB unavailable (very old browser / restricted context) — the
    // submission just isn't retryable across a reload; the in-tab retry
    // (immediate re-attempt on 'online') still works fine.
    return [];
  }
}
