import { SHEET_TABS, csvExportUrl } from '../../config/sheets';
import { PROMO_UNITS, type Promo, type PromoTier, type PromoUnit } from '../types';
import { fetchSheetRows } from './sheetCsv';

const CSV_URL = csvExportUrl(SHEET_TABS.promotions);

function toNumber(v: string | undefined): number {
  const cleaned = (v ?? '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Pick the unit a promotion is priced in from its free-text term / name. */
export function detectUnit(text: string): PromoUnit {
  // Longest-first so "แพ็ค" isn't shadowed by a shorter match.
  const candidates: [RegExp, PromoUnit][] = [
    [/หีบ/, 'หีบ'],
    [/ลัง/, 'ลัง'],
    [/แพ็?ค|แพค/, 'แพ็ค'],
    [/คู่|จับคู่|ซื้อคู่/, 'คู่'],
    [/ชิ้น|ซอง|ขวด|กระป๋อง|ถุง/, 'ชิ้น'],
  ];
  for (const [re, unit] of candidates) if (re.test(text)) return unit;
  return 'ชิ้น';
}

/**
 * Pull volume steps out of the sheet's Thai term text. Handles the two shapes
 * that actually occur, e.g.
 *   "ลังละ 279บาท, 5ลังขึ้นไป 275บาท, 20ลังขึ้นไป 270บาท"
 *   "1 ลัง 535บาท, 10 ลังขึ้นไปลังละ 525บาท, 30 ลังขึ้นไปลังละ 515บาท"
 * Anything it cannot read is left to the caller, which falls back to the
 * single Promotion Price column — the raw text is always preserved too.
 */
export function parseTiers(termText: string): PromoTier[] {
  if (!termText) return [];
  const tiers: PromoTier[] = [];

  for (const rawPart of termText.split(/[,;]/)) {
    const part = rawPart.trim();
    if (!part) continue;

    const priceMatch = part.match(/(\d[\d,]*(?:\.\d+)?)\s*บาท/);
    if (!priceMatch) continue;
    const price = toNumber(priceMatch[1]);
    if (price <= 0) continue;

    // "5ลังขึ้นไป" / "10 ลังขึ้นไป" → threshold 5 / 10
    const threshold = part.match(/(\d+)\s*(?:หีบ|ลัง|แพ็?ค|แพค|ชิ้น|ซอง|ขวด|กระป๋อง|ถุง|คู่)?\s*ขึ้นไป/);
    if (threshold) {
      tiers.push({ minQty: Number(threshold[1]), price });
      continue;
    }

    // "1 ลัง 535บาท" → explicit qty 1; "ลังละ 279บาท" → base tier
    const explicitQty = part.match(/^(\d+)\s*(?:หีบ|ลัง|แพ็?ค|แพค|ชิ้น|ซอง|ขวด|กระป๋อง|ถุง|คู่)/);
    tiers.push({ minQty: explicitQty ? Number(explicitQty[1]) : 1, price });
  }

  // Ascending by quantity, first entry per threshold wins.
  const seen = new Set<number>();
  return tiers
    .sort((a, b) => a.minQty - b.minQty)
    .filter((t) => (seen.has(t.minQty) ? false : (seen.add(t.minQty), true)));
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
  const termText = (row['Promotion Term'] ?? '').trim();

  const unit = detectUnit(`${termText} ${productName}`);
  const parsed = parseTiers(termText);
  const tiers = parsed.length > 0 ? parsed : promoPrice > 0 ? [{ minQty: 1, price: promoPrice }] : [];

  return {
    name: termText || productName,
    value: basePrice > promoPrice && promoPrice > 0 ? `฿${promoPrice}/${unit} (จาก ฿${basePrice})` : `฿${promoPrice}/${unit}`,
    sku,
    skuName: productName,
    type: tiers.length > 1 ? 'ลดขั้นบันได' : 'ลดราคา',
    period: start && end ? `${start} – ${end}` : '',
    st: 'active',
    unit,
    tiers,
    termText,
  };
}

export async function fetchActivePromotions(): Promise<Promo[]> {
  const rows = await fetchSheetRows(CSV_URL);
  return rows.map(rowToPromo).filter((p): p is Promo => p !== null);
}

export { PROMO_UNITS };
