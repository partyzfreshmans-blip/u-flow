// Single source of truth for every Google Sheet this app reads from or
// writes to. Never hardcode a sheet ID or gid anywhere else — import from
// here so a future sheet move/rename is a one-file change.

export const MAIN_SHEET_ID = '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
export const SKU_SHEET_ID = '1gfbuVcH88ugwXgar393voAfcdOsS_qoi9galIFbWNXM';

export const SHEET_TABS = {
  apiImport: { sheetId: MAIN_SHEET_ID, gid: '665542805' },
  routeOrders: { sheetId: MAIN_SHEET_ID, gid: '0' },
  skuDetail: { sheetId: MAIN_SHEET_ID, gid: '772187603' },
  promotions: { sheetId: MAIN_SHEET_ID, gid: '1999566312' },
  csMaster: { sheetId: MAIN_SHEET_ID, gid: '514841442' },
  skuMaster: { sheetId: SKU_SHEET_ID, gid: '0' },
} as const;

export type SheetTabKey = keyof typeof SHEET_TABS;

export function csvExportUrl(tab: { sheetId: string; gid: string }): string {
  return `https://docs.google.com/spreadsheets/d/${tab.sheetId}/export?format=csv&gid=${tab.gid}`;
}
