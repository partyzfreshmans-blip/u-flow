// Goods-receiving records: what a supplier's bill said versus what actually
// arrived. Lives in Postgres now (see server/lib.ts's handleListReceiving/
// handleCreateReceiving/handleDeleteReceiving) instead of browser
// localStorage only — a local cache is still kept (same "instant on load"
// pattern as activityLog.ts/batchRoutes.ts) so the page has something to
// show before the network fetch resolves.
import { authHeaders, type Session } from './session';

export const RECEIVING_TYPES = ['ค่าสินค้า', 'ค่าขนส่ง', 'ส่วนลด'] as const;
export type ReceivingType = (typeof RECEIVING_TYPES)[number];

export const DISCOUNT_MODES = ['baht', 'percent'] as const;
export type DiscountMode = (typeof DISCOUNT_MODES)[number];

export interface ReceivingLine {
  id: string;
  /** SKU id from the app's SKU master, empty for an off-catalogue item. */
  skuId: string;
  /** Product name as it appears in Unii. */
  uniiName: string;
  /** Name printed on the supplier's bill, when it differs from Unii's. */
  billName: string;
  /** Barcode as printed on the bill. */
  billBarcode: string;
  unit: string;
  billQty: number;
  actualQty: number;
  unitPrice: number;
  discount: number;
  discountMode: DiscountMode;
  type: ReceivingType;
  note: string;
}

export interface ReceivingRecord {
  id: string;
  supplier: string;
  billNo: string;
  receivedDate: string;
  recordedBy: string;
  note: string;
  lines: ReceivingLine[];
  createdAt: string;
}

/** Positive = more arrived than billed (over), negative = short. */
export function lineDiff(line: { billQty: number; actualQty: number }): number {
  return line.actualQty - line.billQty;
}

export function lineNetTotal(line: ReceivingLine): number {
  const gross = line.actualQty * line.unitPrice;
  const off = line.discountMode === 'percent' ? (gross * line.discount) / 100 : line.discount;
  return Math.max(0, gross - off);
}

export function recordTotal(record: ReceivingRecord): number {
  return record.lines.reduce((a, l) => a + lineNetTotal(l), 0);
}

export function recordHasDiscrepancy(record: ReceivingRecord): boolean {
  return record.lines.some((l) => lineDiff(l) !== 0);
}

/** Drive folder key for a record's bill: "2026-07-25-บ.สหพัฒนพิบูล จำกัด". */
export function receivingFolderKey(receivedDate: string, supplier: string): string {
  return `${receivedDate || 'ไม่ระบุวันที่'}-${supplier || 'ไม่ระบุซัพพลายเออร์'}`;
}

const STORAGE_KEY = 'warehouse-ops.receiving.v1';

export function loadReceivingLog(): ReceivingRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReceivingRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveReceivingLog(log: ReceivingRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable — the log stays in memory for this session */
  }
}

/** Every receiving record, from Postgres — the real source of truth now.
 * Also refreshes the local cache so the next mount has something instant to
 * show even before this resolves. */
export async function fetchReceivingLog(session: Session | null): Promise<ReceivingRecord[]> {
  let res: Response;
  try {
    res = await fetch('/api/ops/receiving', { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `โหลดข้อมูลรับสินค้าเข้าคลังไม่สำเร็จ (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { receiving?: ReceivingRecord[] };
  const records = Array.isArray(body.receiving) ? body.receiving : [];
  saveReceivingLog(records);
  return records;
}

export async function createReceivingOnServer(session: Session | null, record: ReceivingRecord): Promise<void> {
  const res = await fetch('/api/ops/receiving/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `บันทึกรับสินค้าเข้าคลังไม่สำเร็จ (HTTP ${res.status})`);
  }
}

export async function deleteReceivingOnServer(session: Session | null, id: string): Promise<void> {
  const res = await fetch('/api/ops/receiving/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({ id }),
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `ลบข้อมูลรับสินค้าเข้าคลังไม่สำเร็จ (HTTP ${res.status})`);
  }
}

export function emptyLine(): ReceivingLine {
  return {
    id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    skuId: '',
    uniiName: '',
    billName: '',
    billBarcode: '',
    unit: 'ลัง',
    billQty: 0,
    actualQty: 0,
    unitPrice: 0,
    discount: 0,
    discountMode: 'baht',
    type: 'ค่าสินค้า',
    note: '',
  };
}
