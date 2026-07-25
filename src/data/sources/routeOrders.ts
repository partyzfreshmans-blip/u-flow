import { SHEET_TABS, csvExportUrl } from '../../config/sheets';
import { resolveZoneRoute } from '../routeZones';
import type { RouteOrder } from '../types';
import { fetchSheetRows } from './sheetCsv';

const CSV_URL = csvExportUrl(SHEET_TABS.routeOrders);

function toNumber(v: string | undefined): number {
  const cleaned = (v ?? '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function toFloatOrNull(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rowToRouteOrder(row: Record<string, string>): RouteOrder | null {
  const orderNo = (row['เลขคำสั่งซื้อ'] ?? '').trim();
  if (!orderNo) return null;
  // "Route" is a manual override; when blank, the system-assigned "AutoR" applies.
  const manualRoute = (row['Route'] ?? '').trim();
  const autoRoute = (row['AutoR'] ?? '').trim();
  const districtProvince = (row['อำเภอ, จังหวัด'] ?? '').trim();
  const addressFromUnii = (row['ที่อยู่จาก Unii'] ?? '').trim();
  const zone = resolveZoneRoute(districtProvince, addressFromUnii);
  return {
    route: manualRoute || autoRoute || '—',
    zoneRoute: zone.route,
    zoneReason: zone.reason,
    plannedDeliveryDate: (row['วันที่จะจัดส่ง'] ?? '').trim(),
    orderedAtText: (row['วันเวลาที่สั่ง'] ?? '').trim(),
    customer: (row['ชื่อลูกค้า'] ?? '').trim(),
    orderNo,
    itemCount: toNumber(row['จำนวนรายการ']),
    totalAmount: toNumber(row['ยอดขายรวม']),
    paymentType: (row['การจ่ายเงิน'] ?? '').trim(),
    status: (row['Status'] ?? '').trim(),
    note: (row['หมายเหตุ'] ?? '').trim(),
    isNewCustomer: (row['new customer'] ?? '').trim(),
    orderedDate: (row['วันที่สั่ง'] ?? '').trim(),
    deliveredDate: (row['วันที่จัดส่ง'] ?? '').trim(),
    completedDate: (row['วันที่ส่งสำเร็จ'] ?? '').trim(),
    updatedDate: (row['วันที่อัปเดต'] ?? '').trim(),
    districtProvince,
    addressFromUnii,
    mapLink: (row['Link'] ?? '').trim(),
    lat: toFloatOrNull(row['CS_Lat']),
    lng: toFloatOrNull(row['CS_Long']),
    phone: (row['Phone Number'] ?? '').trim(),
    distanceFromWhKm: toFloatOrNull(row['far_from_wh']),
    whLat: toFloatOrNull(row['wh_lat']),
    whLng: toFloatOrNull(row['wh_long']),
  };
}

export async function fetchRouteOrders(): Promise<RouteOrder[]> {
  const rows = await fetchSheetRows(CSV_URL);
  return rows.map(rowToRouteOrder).filter((o): o is RouteOrder => o !== null);
}
