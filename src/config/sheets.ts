// Single source of truth for every Google Sheet this app reads from or
// writes to. Never hardcode a sheet ID or gid anywhere else — import from
// here so a future sheet move/rename is a one-file change.

export const MAIN_SHEET_ID = '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
export const SKU_SHEET_ID = '1gfbuVcH88ugwXgar393voAfcdOsS_qoi9galIFbWNXM';

export const SHEET_TABS = {
  // The one raw source of truth for order data, straight from Unii — read
  // live every time (src/data/sources/apiImportOrders.ts), never synced
  // anywhere else. Every column this tab has gets captured (named fields for
  // known ones, a `raw` passthrough for everything else).
  apiImport: { sheetId: MAIN_SHEET_ID, gid: '665542805' },
  // Staff-entered order fields (delivery date, note, tax invoice, courier,
  // archive, etc.) and promotions both moved off Sheets into Postgres — see
  // server/lib.ts's handleListRouteOrders/handleUpsertBatchRoutes and
  // handleListPromotions/handleUpsertPromotion. joinRouteOrders
  // (src/data/sources/routeOrders.ts) still joins that Postgres data with
  // this tab by Order UID at render time. skuDetail is still read live for
  // line items and promo links.
  skuDetail: { sheetId: MAIN_SHEET_ID, gid: '772187603' },
  csMaster: { sheetId: MAIN_SHEET_ID, gid: '514841442' },
  skuMaster: { sheetId: SKU_SHEET_ID, gid: '0' },
} as const;

export type SheetTabKey = keyof typeof SHEET_TABS;

export function csvExportUrl(tab: { sheetId: string; gid: string }): string {
  return `https://docs.google.com/spreadsheets/d/${tab.sheetId}/export?format=csv&gid=${tab.gid}`;
}
