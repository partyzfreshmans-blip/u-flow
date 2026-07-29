import { SHEET_TABS, csvExportUrl } from '../../config/sheets';
import type { ApiImportOrder } from '../types';
import { fetchSheetRows } from './sheetCsv';

const CSV_URL = csvExportUrl(SHEET_TABS.apiImport);

function toNumber(v: string | undefined): number {
  const cleaned = (v ?? '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function toLatLng(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rowToOrder(row: Record<string, string>): ApiImportOrder | null {
  const orderUid = (row['Order UID'] ?? '').trim();
  if (!orderUid) return null;
  return {
    no: (row['No.'] ?? '').trim(),
    orderUid,
    status: (row['สถานะ'] ?? '').trim(),
    paymentType: (row['ประเภทชำระเงิน'] ?? '').trim(),
    paid: (row['ชำระเงินแล้ว'] ?? '').trim(),
    itemCount: toNumber(row['จำนวนรายการ']),
    totalAmount: toNumber(row['ยอดขายรวม']),
    customer: (row['ลูกค้า'] ?? '').trim(),
    phone: (row['เบอร์โทร'] ?? '').trim(),
    address: (row['ที่อยู่'] ?? '').trim(),
    district: (row['อำเภอ'] ?? '').trim(),
    province: (row['จังหวัด'] ?? '').trim(),
    orderedAt: (row['วันที่สั่ง'] ?? '').trim(),
    deliveredAt: (row['วันที่จัดส่ง'] ?? '').trim(),
    completedAt: (row['วันที่ส่งสำเร็จ'] ?? '').trim(),
    wantsTaxInvoice: (row['ขอใบกำกับภาษี'] ?? '').trim(),
    updatedAt: (row['วันที่อัปเดต'] ?? '').trim(),
    lat: toLatLng(row['Latitude']),
    lng: toLatLng(row['Longitude']),
    // Observed under these exact snake_case names (unlike every other column
    // here) — likely passed through by Unii without a Thai relabel. Optional:
    // null when this tab doesn't carry them, same as if they were never read.
    distanceFromWhKm: toLatLng(row['far_from_wh']),
    whLat: toLatLng(row['wh_lat']),
    whLng: toLatLng(row['wh_long']),
    raw: row,
  };
}

export async function fetchApiImportOrders(): Promise<ApiImportOrder[]> {
  const rows = await fetchSheetRows(CSV_URL);
  return rows.map(rowToOrder).filter((o): o is ApiImportOrder => o !== null);
}
