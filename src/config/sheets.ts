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
  // The one raw source of truth for order data — read live every time
  // through this app's own authenticated backend (see
  // src/data/sources/apiImportOrders.ts and server/lib.ts's
  // handleFetchApiImportOrders), never synced anywhere else. Every column
  // this tab has gets captured (named fields for known ones, a `raw`
  // passthrough for everything else).
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
  ordersGid0: { sheetId: MAIN_SHEET_ID, gid: '0' },
} as const;

/** Exact header text and left-to-right order (columns A–M) for "คำสั่งซื้อ VS"
 * as the real sheet actually has it — the single source of truth both the
 * frontend reader (staffOrderInfo.ts) and the backend writer/exporter
 * (server/lib.ts) key off of by name, never by column position. Confirmed
 * directly against the live sheet (2026-08), since the sheet is set up and
 * maintained by hand and has its own Apps Script/formulas referencing these
 * exact header strings — never rename any of them here without renaming
 * them in the sheet first.
 *
 * "เลขคำสั่งซื้อ" (the order number, e.g. "UM-260802-3582498251") is the join
 * key against API Import's own "Order UID" column — same value, different
 * header text in each tab. "โปรโมชั่น" exists in the sheet but nothing in
 * this app reads or writes it. "new customer" and "Phone" are populated by
 * an ARRAYFORMULA anchored elsewhere in the sheet — see
 * STAFF_READONLY_HEADERS below — they must never be written by this app or
 * the formula breaks for the whole column. */
export const STAFF_ORDER_INFO_HEADERS = [
  'เลขคำสั่งซื้อ', // A — join key
  'Route', // B — vehicle/route name, set on batch Assign
  'BATCH ROUTE', // C — batch id, set on batch Assign
  'วันที่จะจัดส่ง', // D
  'หมายเหตุ', // E
  'ใบกำกับภาษี', // F
  'โปรโมชั่น', // G — not used by this app
  'ปัญหาการส่ง', // H — this app's operational status (mark-delivered / delivery-failed / pick-lot-close all write here)
  'คนส่ง', // I — driver username, set on batch Assign
  'วันที่ Assign', // J — set on batch Assign
  'new customer', // K — READ-ONLY, ARRAYFORMULA-driven
  'Phone', // L — READ-ONLY, ARRAYFORMULA-driven
  'Archived', // M
] as const;

/** Columns this app must never write to under any circumstance — both are
 * driven by an ARRAYFORMULA elsewhere in the sheet that spills its computed
 * value into every row of the column; writing even an empty string into
 * one of these cells plants a literal value that blocks the formula's
 * spill for that row and breaks it for the rest of the column below.
 * server/lib.ts checks every write against this set before it ever reaches
 * the Sheets API, as a second line of defense beyond just "don't look these
 * headers up as write targets." */
export const STAFF_READONLY_HEADERS = new Set<string>(['new customer', 'Phone']);

export type SheetTabKey = keyof typeof SHEET_TABS;

/** True until SHEET_TABS.routeOrders.gid is updated with the real gid of the
 * "คำสั่งซื้อ VS" tab. Checked by both the frontend's authenticated read
 * (src/data/sources/staffOrderInfo.ts) and every backend handler that
 * touches this tab, so an un-updated config fails loudly and specifically
 * instead of a confusing generic error. */
export function isRouteOrdersTabConfigured(): boolean {
  return (SHEET_TABS.routeOrders.gid as string) !== GID_NOT_CONFIGURED;
}

export const ROUTE_ORDERS_NOT_CONFIGURED_MESSAGE =
  'ยังไม่ได้ตั้งค่า gid ของแท็บ "คำสั่งซื้อ VS" — สร้างแท็บใน Google Sheets แล้วอัปเดต SHEET_TABS.routeOrders.gid ใน src/config/sheets.ts ก่อนใช้งาน';
