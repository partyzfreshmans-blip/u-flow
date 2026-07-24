import Papa from 'papaparse';
import type { Sku } from '../types';

const SHEET_ID = '1gfbuVcH88ugwXgar393voAfcdOsS_qoi9galIFbWNXM';
const GID = '0';

// Public "anyone with the link can view" sheet — CSV export needs no API key.
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

interface SheetRow {
  'SKU ID': string;
  'บาร์โค้ด (Barcode)': string;
  'ชื่อสินค้า (Product Name)': string;
  'หน่วยสินค้า (Unit)': string;
  Barcode: string;
  Comment: string;
  'สต็อกปัจจุบัน (Stock)': string;
  'สถานะในสต็อก (In Stock)': string;
  'แหล่งข้อมูล (Branch/Hub)': string;
}

function cleanBarcode(...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    const v = (c ?? '').trim();
    if (v && v !== '-' && v !== '\\-') return v;
  }
  return '';
}

function rowToSku(row: SheetRow, index: number): Sku | null {
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
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(`Failed to load SKU sheet (HTTP ${res.status})`);
  }
  const csvText = await res.text();
  const parsed = Papa.parse<SheetRow>(csvText, { header: true, skipEmptyLines: true });
  return parsed.data.map(rowToSku).filter((s): s is Sku => s !== null);
}

export { CSV_URL as SKU_SHEET_CSV_URL };
