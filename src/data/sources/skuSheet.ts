import { SHEET_TABS, csvExportUrl } from '../../config/sheets';
import type { Sku } from '../types';
import { fetchSheetRows } from './sheetCsv';

const CSV_URL = csvExportUrl(SHEET_TABS.skuMaster);

function cleanBarcode(...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    const v = (c ?? '').trim();
    if (v && v !== '-' && v !== '\\-') return v;
  }
  return '';
}

function rowToSku(row: Record<string, string>, index: number): Sku | null {
  const skuId = (row['SKU ID'] ?? '').trim();
  const name = (row['ชื่อสินค้า (Product Name)'] ?? '').trim();
  if (!skuId && !name) return null; // skip fully blank rows

  const barcode = cleanBarcode(row['Barcode'], row['บาร์โค้ด (Barcode)']);
  const unit = (row['หน่วยสินค้า (Unit)'] ?? '').trim();
  const stockRaw = (row['สต็อกปัจจุบัน (Stock)'] ?? '').trim();
  const stock = stockRaw ? Number(stockRaw.replace(/[^0-9.-]/g, '')) || 0 : 0;
  const inStock = (row['สถานะในสต็อก (In Stock)'] ?? '').trim();

  return {
    // SKU IDs repeat across packaging-variant rows in the source sheet, so the
    // row index keeps each row uniquely addressable for edit/lookup in the UI.
    id: `${skuId || 'ROW'}-${index}`,
    displayId: skuId || `(ไม่มีรหัส-${index})`,
    barcode,
    name: name || unit || skuId,
    unit: unit || '-',
    stock,
    status: inStock === 'หมด' ? 'inactive' : 'active',
  };
}

export async function fetchSkusFromSheet(): Promise<Sku[]> {
  const rows = await fetchSheetRows(CSV_URL);
  return rows.map(rowToSku).filter((s): s is Sku => s !== null);
}

export { CSV_URL as SKU_SHEET_CSV_URL };
