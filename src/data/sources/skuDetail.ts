import { SHEET_TABS, csvExportUrl } from '../../config/sheets';
import type { OrderLineItem } from '../types';
import { fetchSheetRows } from './sheetCsv';

const CSV_URL = csvExportUrl(SHEET_TABS.skuDetail);

function toNumber(v: string | undefined): number {
  const cleaned = (v ?? '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function rowToLineItem(row: Record<string, string>): OrderLineItem | null {
  const orderNo = (row['เลขคำสั่งซื้อ'] ?? '').trim();
  const sku = (row['SKU'] ?? '').trim();
  if (!orderNo || !sku) return null;
  return {
    no: (row['No.'] ?? '').trim(),
    orderNo,
    orderedAt: (row['วันที่สั่ง'] ?? '').trim(),
    customer: (row['ชื่อลูกค้า'] ?? '').trim(),
    sku,
    productName: (row['ชื่อสินค้า'] ?? '').trim(),
    unit: (row['หน่วย'] ?? '').trim(),
    qty: toNumber(row['จำนวน']),
    unitPrice: toNumber(row['ราคา/หน่วย']),
    discount: toNumber(row['ส่วนลด']),
    lineTotal: toNumber(row['ยอดรวมรายการ']),
  };
}

/** Line items for one order. Fetches (and caches, via fetchSheetRows) the
 * whole tab once, then filters client-side — Sheets CSV export can't filter
 * server-side by column value. */
export async function fetchOrderLineItems(orderUid: string): Promise<OrderLineItem[]> {
  const rows = await fetchSheetRows(CSV_URL);
  return rows
    .map(rowToLineItem)
    .filter((l): l is OrderLineItem => l !== null)
    .filter((l) => l.orderNo === orderUid);
}

/** Same as fetchOrderLineItems but for a whole batch-picking selection at
 * once — one fetch (already cached) instead of one round trip per order. */
export async function fetchOrderLineItemsForOrders(orderNos: string[]): Promise<OrderLineItem[]> {
  const wanted = new Set(orderNos);
  const rows = await fetchSheetRows(CSV_URL);
  return rows
    .map(rowToLineItem)
    .filter((l): l is OrderLineItem => l !== null)
    .filter((l) => wanted.has(l.orderNo));
}
