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

/** The sheet's "หน่วยสินค้า (Unit)" column holds the full packaging-variant
 * description, not a short unit word — and "ชื่อสินค้า (Product Name)" is
 * itself built as "{base name} ({that same unit value})", so showing the
 * unit column verbatim next to the name column is almost entirely
 * redundant (e.g. name "ทับทิม น้ำมันปาล์ม ขวด 1ลิตร (...แพค/6ขวด)", unit
 * "ทับทิม น้ำมันปาล์ม ขวด 1ลิตร แพค/6ขวด"). Strip the shared base-name
 * prefix so only the actual packaging distinguisher shows ("แพค/6ขวด",
 * "ทีบX12"); when there's no suffix at all (the single-unit base row),
 * falls back to "ชิ้น". */
function cleanUnit(rawUnit: string, name: string): string {
  const u = rawUnit.trim();
  if (!u) return '-';
  const parenIdx = name.indexOf('(');
  const base = (parenIdx === -1 ? name : name.slice(0, parenIdx)).trim();
  if (base && u.startsWith(base)) {
    return u.slice(base.length).trim() || 'ชิ้น';
  }
  return u;
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
  // Not a real column in the sheet today — checked defensively under a few
  // plausible names so batch picking can show it the moment one is added.
  const location = (row['ตำแหน่งจัดเก็บ'] ?? row['ตำแหน่ง (Location)'] ?? row['Location'] ?? row['ที่จัดเก็บ'] ?? '').trim();
  const displayName = name || unit || skuId;

  return {
    // SKU IDs repeat across packaging-variant rows in the source sheet, so the
    // row index keeps each row uniquely addressable for edit/lookup in the UI.
    id: `${skuId || 'ROW'}-${index}`,
    displayId: skuId || `(ไม่มีรหัส-${index})`,
    barcode,
    name: displayName,
    unit: cleanUnit(unit, displayName),
    stock,
    status: inStock === 'หมด' ? 'inactive' : 'active',
    location,
  };
}

export async function fetchSkusFromSheet(): Promise<Sku[]> {
  const rows = await fetchSheetRows(CSV_URL);
  return rows.map(rowToSku).filter((s): s is Sku => s !== null);
}

export { CSV_URL as SKU_SHEET_CSV_URL };
