// Single source of truth for every Google Sheet this app reads from or
// writes to. Never hardcode a sheet ID or gid anywhere else — import from
// here so a future sheet move/rename is a one-file change.

export const MAIN_SHEET_ID = '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
export const SKU_SHEET_ID = '1gfbuVcH88ugwXgar393voAfcdOsS_qoi9galIFbWNXM';

/** Placeholder gid for a tab that hasn't been created/configured yet — never
 * a real Google Sheets gid (those are always non-negative integers), so it
 * can't accidentally collide with one. See ROUTE_ORDERS_TAB_NOT_CONFIGURED. */
const GID_NOT_CONFIGURED = 'NOT_CONFIGURED';

export const SHEET_TABS = {
  apiImport: { sheetId: MAIN_SHEET_ID, gid: '665542805' },
  // "คำสั่งซื้อ" (gid 0) used a row-position-based VLOOKUP/IMPORTRANGE
  // formula to pull in API Import data, which broke (staff-entered Route/
  // note/tax-invoice/delivery-date landing on the wrong order) whenever a
  // new row was inserted above existing ones in API Import. Replaced by a
  // new tab, "คำสั่งซื้อ VS" (gid 848682054, a duplicate of the old tab with
  // its existing data carried over), synced by the app itself via
  // handleSyncRouteOrders (server/lib.ts) matching strictly by Order UID —
  // never row position. The old "คำสั่งซื้อ" tab (gid 0) is kept as a
  // read-only historical backup; nothing in this app reads or writes it
  // anymore.
  routeOrders: { sheetId: MAIN_SHEET_ID, gid: '848682054' },
  skuDetail: { sheetId: MAIN_SHEET_ID, gid: '772187603' },
  promotions: { sheetId: MAIN_SHEET_ID, gid: '1999566312' },
  csMaster: { sheetId: MAIN_SHEET_ID, gid: '514841442' },
  skuMaster: { sheetId: SKU_SHEET_ID, gid: '0' },
} as const;

export type SheetTabKey = keyof typeof SHEET_TABS;

export function csvExportUrl(tab: { sheetId: string; gid: string }): string {
  return `https://docs.google.com/spreadsheets/d/${tab.sheetId}/export?format=csv&gid=${tab.gid}`;
}

/** True until SHEET_TABS.routeOrders.gid is updated with the real gid of the
 * "คำสั่งซื้อ VS" tab. Checked by both the frontend CSV read and every
 * backend handler that touches this tab, so an un-updated config fails
 * loudly and specifically instead of a confusing generic error. */
export function isRouteOrdersTabConfigured(): boolean {
  return (SHEET_TABS.routeOrders.gid as string) !== GID_NOT_CONFIGURED;
}

export const ROUTE_ORDERS_NOT_CONFIGURED_MESSAGE =
  'ยังไม่ได้ตั้งค่า gid ของแท็บ "คำสั่งซื้อ VS" — สร้างแท็บใน Google Sheets แล้วอัปเดต SHEET_TABS.routeOrders.gid ใน src/config/sheets.ts ก่อนใช้งาน';
