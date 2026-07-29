// Local record of "ส่งไม่สำเร็จ" (delivery failed) detail — reason, note, and
// Drive photo links — for orders whose Status has been set to the new
// 'ส่งไม่สำเร็จ' value (see server/lib.ts's KNOWN_STATUS_VALUES). The Status
// column itself round-trips through the sheet like any other order status;
// this richer detail has no dedicated sheet column, so it's kept the same
// way attachment metadata already is (localStorage index, see
// src/data/sources/attachments.ts) rather than overloading the order's
// free-text "note" column, which a later unrelated edit could overwrite.

export interface DeliveryFailureRecord {
  orderNo: string;
  reason: string;
  note: string;
  photoLinks: { fileId: string; webViewLink: string; name: string }[];
  failedAt: string; // ISO timestamp
  failedBy: string; // username
}

export type DeliveryFailureIndex = Record<string, DeliveryFailureRecord>;

const STORAGE_KEY = 'warehouse-ops.deliveryFailures.v1';

export function loadDeliveryFailures(): DeliveryFailureIndex {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as DeliveryFailureIndex) : {};
  } catch {
    return {};
  }
}

export function saveDeliveryFailures(index: DeliveryFailureIndex): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    /* storage unavailable — record stays in memory for this session */
  }
}

/** Common reasons a driver picks from — free-text note still available for
 * anything more specific. */
export const DELIVERY_FAILURE_REASONS = ['ลูกค้าไม่รับสาย/ไม่อยู่', 'ลูกค้าปฏิเสธรับสินค้า', 'ที่อยู่ไม่ถูกต้อง/หาไม่เจอ', 'อื่นๆ'] as const;
