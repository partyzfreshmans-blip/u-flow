// Reads "คำสั่งซื้อ VS" under its new, staff-data-only column layout — see
// config/sheets.ts's STAFF_ORDER_INFO_HEADERS for the exact header text/order
// this expects, and joinRouteOrders (routeOrders.ts) for how this gets
// combined with ApiImportOrder to build the RouteOrder every page reads.
import type { Session } from '../session';
import type { StaffOrderInfo } from '../types';
import { fetchSheetRowsFromBackend } from './sheetRowsApi';

function parseTriStateBool(v: string | undefined): boolean | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return /^(ใช่|yes|true|y)$/i.test(s);
}

function rowToStaffOrderInfo(row: Record<string, string>): StaffOrderInfo | null {
  const orderUid = (row['Order UID'] ?? '').trim();
  if (!orderUid) return null;
  return {
    orderUid,
    plannedDeliveryDate: (row['วันที่จะจัดส่ง'] ?? '').trim(),
    note: (row['หมายเหตุ'] ?? '').trim(),
    taxInvoiceOverride: parseTriStateBool(row['ขอใบกำกับภาษี']),
    operationalStatus: (row['สถานะการดำเนินงาน'] ?? '').trim(),
    operationalStatusAt: (row['เวลาที่บันทึกสถานะ'] ?? '').trim(),
    courierStamp: (row['คนส่ง'] ?? '').trim(),
    archived: /^(ใช่|yes|true|y)$/i.test((row['Archived'] ?? '').trim()),
    newCustomer: (row['new customer'] ?? '').trim(),
  };
}

export async function fetchStaffOrderInfo(session: Session | null): Promise<StaffOrderInfo[]> {
  const { rows } = await fetchSheetRowsFromBackend(session, '/api/route-orders/staff-info');
  return rows.map(rowToStaffOrderInfo).filter((o): o is StaffOrderInfo => o !== null);
}
