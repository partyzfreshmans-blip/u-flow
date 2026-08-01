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
  // The one raw source of truth for order data, straight from Unii — read
  // live every time (src/data/sources/apiImportOrders.ts), never synced
  // anywhere else. Every column this tab has gets captured (named fields for
  // known ones, a `raw` passthrough for everything else).
  apiImport: { sheetId: MAIN_SHEET_ID, gid: '665542805' },
  // "คำสั่งซื้อ" (gid 0) used a row-position-based VLOOKUP/IMPORTRANGE formula
  // to pull in API Import data, which broke (staff-entered fields landing on
  // the wrong order) whenever a new row was inserted above existing ones in
  // API Import. Its replacement, "คำสั่งซื้อ VS" (this key, gid 848682054),
  // first tried fixing that by syncing API Import's columns into this tab by
  // Order UID — but that just traded one class of bug for another (a sync
  // that has to rewrite the entire sheet's history every run to catch every
  // status change is itself fragile and slow). This tab now holds ONLY data
  // staff enter through this app's own UI — see STAFF_ORDER_INFO_HEADERS for
  // its exact columns — and nothing here is ever a copy of an API Import
  // column. joinRouteOrders (src/data/sources/routeOrders.ts) combines the
  // two by Order UID at render time instead: no sync step, no "did the last
  // sync actually finish" question, no columns that can silently drift out
  // of alignment. The old "คำสั่งซื้อ" tab (gid 0) is kept as a read-only
  // historical backup; nothing in this app reads or writes it anymore.
  routeOrders: { sheetId: MAIN_SHEET_ID, gid: '848682054' },
  skuDetail: { sheetId: MAIN_SHEET_ID, gid: '772187603' },
  promotions: { sheetId: MAIN_SHEET_ID, gid: '1999566312' },
  csMaster: { sheetId: MAIN_SHEET_ID, gid: '514841442' },
  skuMaster: { sheetId: SKU_SHEET_ID, gid: '0' },
} as const;

/** Exact header text and left-to-right order for "คำสั่งซื้อ VS" under the
 * new staff-only layout — the single source of truth both the frontend
 * reader (staffOrderInfo.ts) and the backend writer (server/lib.ts) key off
 * of by name, never by column position. Order UID is the join key against
 * API Import; every other column is something staff enter through this
 * app's own UI (see src/data/types.ts's StaffOrderInfo for what each one
 * means) — nothing here duplicates a column API Import already has. */
export const STAFF_ORDER_INFO_HEADERS = [
  'Order UID',
  'วันที่จะจัดส่ง',
  'หมายเหตุ',
  'ขอใบกำกับภาษี',
  'สถานะการดำเนินงาน',
  'เวลาที่บันทึกสถานะ',
  'คนส่ง',
  'Archived',
  'new customer',
] as const;

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
