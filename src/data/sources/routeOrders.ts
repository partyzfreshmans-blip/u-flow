// The runtime join: API Import (the one raw source of truth for order data)
// combined with คำสั่งซื้อ VS (staff-entered-only overlay), by Order UID, into
// the RouteOrder every page in the app actually reads. Replaces the old
// sync-two-sheets-together design — there is no longer any "did the last
// sync actually finish, and did it write every column" question, because
// nothing is ever copied between the two tabs; this just reads both, fresh,
// every time, and joins them in memory.
import { isRouteOrdersTabConfigured, ROUTE_ORDERS_NOT_CONFIGURED_MESSAGE } from '../../config/sheets';
import type { Session } from '../session';
import type { ApiImportOrder, RouteOrder, StaffOrderInfo } from '../types';
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
      promotionFlag: staff?.promotionFlag ?? false,
    };
  });
}

/** Reads both sources live and joins them — the one function every page
 * should call for order data. Kept under this name (unchanged from the old
 * sync-based design) so every existing call site — the mount effect and
 * actions.syncNow in store.ts — needed no changes at all beyond passing a
 * session through. Both sources now go through this app's own authenticated
 * backend (see apiImportOrders.ts / staffOrderInfo.ts) rather than a public
 * CSV export, so a session is required for both; a `stale` live read on
 * either backend endpoint's side (served from its own ~60s cache after a
 * failed refresh) is intentionally not surfaced here — the join still
 * returns real, just possibly slightly old, data rather than failing the
 * whole page. */
export async function fetchRouteOrders(session: Session | null): Promise<RouteOrder[]> {
  if (!isRouteOrdersTabConfigured()) throw new Error(ROUTE_ORDERS_NOT_CONFIGURED_MESSAGE);
  const [apiImportResult, staffInfos] = await Promise.all([fetchApiImportOrders(session), fetchStaffOrderInfo(session)]);
  return joinRouteOrders(apiImportResult.orders, staffInfos);
}
