import { SHEET_TABS, csvExportUrl } from '../../config/sheets';
import type { CsMasterCustomer } from '../types';
import { fetchSheetRows } from './sheetCsv';

const CSV_URL = csvExportUrl(SHEET_TABS.csMaster);

function toFloatOrNull(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rowToCustomer(row: Record<string, string>, index: number): CsMasterCustomer | null {
  const name = (row['ชื่อ'] ?? '').trim();
  const phone = (row['เบอร์'] ?? '').trim();
  if (!name && !phone) return null; // skip fully blank rows
  return {
    rowIndex: index + 2, // header is row 1; first data row is row 2
    name,
    phone,
    address: (row['ที่อยู่'] ?? '').trim(),
    lat: toFloatOrNull(row['ละ']),
    lng: toFloatOrNull(row['ลอง']),
    mapLink: (row['ลิ้ง'] ?? '').trim(),
    wantsTaxInvoice: (row['ขอใบกำกับภาษี'] ?? '').trim(),
    note: (row['หมายเหตุ'] ?? '').trim(),
  };
}

export async function fetchCsMasterCustomers(): Promise<CsMasterCustomer[]> {
  const rows = await fetchSheetRows(CSV_URL);
  return rows.map(rowToCustomer).filter((c): c is CsMasterCustomer => c !== null);
}

export { CSV_URL as CS_MASTER_CSV_URL };
