import { SHEET_TABS, csvExportUrl } from '../../config/sheets';
import type { Promo } from '../types';
import { fetchSheetRows } from './sheetCsv';

const CSV_URL = csvExportUrl(SHEET_TABS.promotions);

function toNumber(v: string | undefined): number {
  const cleaned = (v ?? '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function rowToPromo(row: Record<string, string>): Promo | null {
  const sku = (row['SKU'] ?? '').trim();
  const status = (row['Status'] ?? '').trim();
  if (!sku || status !== 'Active') return null;

  const productName = (row['Product Name'] ?? '').trim();
  const promoPrice = toNumber(row['Promotion Price']);
  const basePrice = toNumber(row['Box Price']) || toNumber(row['Single Price']);
  const start = (row['เริ่มโปร'] ?? '').trim();
  const end = (row['สินสุด'] ?? '').trim();
  const term = (row['Promotion Term'] ?? '').trim();

  return {
    name: term || productName,
    value: basePrice > promoPrice ? `฿${promoPrice} (จาก ฿${basePrice})` : `฿${promoPrice}`,
    sku,
    skuName: productName,
    type: 'ลดราคา',
    period: start && end ? `${start} – ${end}` : '',
    st: 'active',
  };
}

export async function fetchActivePromotions(): Promise<Promo[]> {
  const rows = await fetchSheetRows(CSV_URL);
  return rows.map(rowToPromo).filter((p): p is Promo => p !== null);
}
