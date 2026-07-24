import type { LatLngOverride } from '../types';

// Corrected lat/lng live in IndexedDB, separate from the Unii API data, so a
// bad upstream coordinate never overwrites what a warehouse staffer fixed.
const DB_NAME = 'warehouse-ops';
const DB_VERSION = 1;
const STORE_NAME = 'customerLatLngOverrides';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'));
  });
}

export async function loadAllOverrides(): Promise<Record<string, LatLngOverride>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const result: Record<string, LatLngOverride> = {};
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        result[String(cursor.key)] = cursor.value as LatLngOverride;
        cursor.continue();
      } else {
        resolve(result);
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error('Failed to read overrides'));
  });
}

export async function saveOverride(customerId: string, lat: number, lng: number): Promise<void> {
  const db = await openDb();
  const entry: LatLngOverride = { lat, lng, updatedAt: new Date().toISOString() };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(entry, customerId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to save override'));
  });
}

export async function clearOverride(customerId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(customerId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Failed to clear override'));
  });
}
