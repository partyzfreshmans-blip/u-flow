// The runtime join: API Import (the one raw source of truth for order data)
// combined with คำสั่งซื้อ VS (staff-entered-only overlay), by Order UID, into
// the RouteOrder every page in the app actually reads. Replaces the old
// sync-two-sheets-together design — there is no longer any "did the last
// sync actually finish, and did it write every column" question, because
// nothing is ever copied between the two tabs; this just reads both, fresh,
// every time, and joins them in memory.
import type { ApiImportOrder, RouteOrder, StaffOrderInfo } from '../types';
import type { Session } from '../session';
import { fetchApiImportOrders } from './apiImportOrders';
import { fetchStaffOrderInfo } from './staffOrderInfo';

function parseYesNo(text: string): boolean {
  return /^(ใช่|yes|true|y)$/i.test(text.trim());
}

/**
 * Pure join, no I/O — unit-testable directly against fixture arrays. A
 * brand new order with no คำสั่งซื้อ VS row yet just gets every staff-entered
 * field defaulted (blank note/delivery-date, not archived, no operational
 * status override) rather than being excluded or erroring.
 */
export function joinRouteOrders(apiImportOrders: ApiImportOrder[], staffInfos: StaffOrderInfo[]): RouteOrder[] {
  const staffByUid = new Map(staffInfos.map((s) => [s.orderUid, s]));
  return apiImportOrders.map((o): RouteOrder => {
    const staff: StaffOrderInfo | undefined = staffByUid.get(o.orderUid);
    const districtProvince = [o.district, o.province].filter(Boolean).join(', ');
    const mapLink = o.lat != null && o.lng != null ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}` : '';
    return {
      orderedAtText: o.orderedAt,
      customer: o.customer,
      orderNo: o.orderUid,
      itemCount: o.itemCount,
      totalAmount: o.totalAmount,
      paymentType: o.paymentType,
      // The app's own operational outcome (mark-delivered/delivery-failed/
      // pick-lot-close) wins once it's ever been set — that's this app's own
      // record of something Unii's own pipeline may not yet reflect.
      status: staff?.operationalStatus || o.status,
      plannedDeliveryDate: staff?.plannedDeliveryDate ?? '',
      note: staff?.note ?? '',
      isNewCustomer: staff?.newCustomer ?? '',
      orderedDate: o.orderedAt,
      deliveredDate: o.deliveredAt,
      completedDate: o.completedAt,
      updatedDate: o.updatedAt,
      wantsTaxInvoice: staff?.taxInvoiceOverride ?? parseYesNo(o.wantsTaxInvoice),
      archived: staff?.archived ?? false,
      districtProvince,
      addressFromUnii: o.address,
      mapLink,
      lat: o.lat,
      lng: o.lng,
      phone: o.phone,
      distanceFromWhKm: o.distanceFromWhKm,
      whLat: o.whLat,
      whLng: o.whLng,
      courierStamp: staff?.courierStamp ?? '',
    };
  });
}

/** Reads both sources live and joins them — the one function every page
 * should call for order data. Kept under this name (unchanged from the old
 * sync-based design) so every existing call site — the mount effect and
 * actions.syncNow in store.ts — needed no changes beyond passing a session.
 * ApiImportOrder now comes straight from the Unii API via this app's backend
 * proxy (server/unii.ts), and StaffOrderInfo comes from Postgres — both
 * authenticated backend calls now, hence the session parameter on both. */
export async function fetchRouteOrders(session: Session | null): Promise<RouteOrder[]> {
  const [apiImportOrders, staffInfos] = await Promise.all([fetchApiImportOrders(session), fetchStaffOrderInfo(session)]);
  return joinRouteOrders(apiImportOrders, staffInfos);
}
