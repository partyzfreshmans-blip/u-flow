import { SHEET_TABS, csvExportUrl } from '../../config/sheets';
import { PROMO_UNITS, type Promo, type PromoPackUnit, type PromoTier, type PromoUnit } from '../types';
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

const PACK_UNIT_LABEL_RE = PROMO_UNITS.join('|');
const PACK_UNIT_RE = new RegExp(`^(${PACK_UNIT_LABEL_RE})\\s*(?:\\((\\d+)[^)]*\\))?\\s*ละ\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*บาท`);

/**
 * Pull packaging-unit prices out of the sheet's Thai term text — a DIFFERENT
 * shape from parseTiers's "buy more, pay less" steps: this is "priced
 * differently per packaging size", e.g.
 *   "ชิ้นละ 42บาท, แพ็ค(4)ละ 157บาท, หีบ(24)ละ 790บาท"
 * Requires at least 2 distinctly-labelled units to activate — a single flat
 * price is already handled fine by parseTiers's minQty=1 fallback, so this
 * only kicks in for the genuinely multi-packaging-unit case this format
 * exists for. Returns [] (letting the caller fall back to parseTiers) unless
 * every comma-separated part parses cleanly as a pack-unit line.
 */
export function parsePackUnits(termText: string): PromoPackUnit[] {
  if (!termText) return [];
  const units: PromoPackUnit[] = [];

  for (const rawPart of termText.split(/[,;]/)) {
    const part = rawPart.trim();
    if (!part) continue;
    const m = part.match(PACK_UNIT_RE);
    if (!m) return [];
    const price = toNumber(m[3]);
    if (price <= 0) return [];
    units.push({ label: m[1] as PromoUnit, qtyPerUnit: m[2] ? Number(m[2]) : 1, price });
  }

  if (units.length < 2) return [];
  const seen = new Set<string>();
  return units.filter((u) => (seen.has(u.label) ? false : (seen.add(u.label), true)));
}

/** Average price per contained piece, i.e. price ÷ how many are packed
 * inside — a reference figure so staff can see at a glance which packaging
 * size is the better deal, not a claim that all levels share one true base
 * unit (a หีบ's "790 ÷ 24 แพ็ค" figure is per-แพ็ค-inside-the-หีบ, exactly as
 * the packed count on that entry describes it). */
export function avgPricePerPiece(u: PromoPackUnit): number {
  return u.qtyPerUnit > 0 ? u.price / u.qtyPerUnit : u.price;
}

/** Serializes packaging-unit prices back to the sheet's free-text term
 * format — the exact inverse of parsePackUnits, so a promo saved from the
 * web form round-trips identically on the next read. */
export function formatPackUnitsTerm(units: PromoPackUnit[]): string {
  return units
    .map((u) => `${u.label}${u.qtyPerUnit > 1 ? `(${u.qtyPerUnit})` : ''}ละ ${u.price.toLocaleString('en-US')}บาท`)
    .join(', ');
}

/** Serializes stepped-quantity tiers back to the sheet's free-text term
 * format, matching parseTiers's own documented shape. */
export function formatTiersTerm(tiers: PromoTier[], unit: PromoUnit): string {
  return tiers
    .map((t) => (t.minQty > 1 ? `${t.minQty}${unit}ขึ้นไป ${t.price.toLocaleString('en-US')}บาท` : `${unit}ละ ${t.price.toLocaleString('en-US')}บาท`))
    .join(', ');
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

  const packUnits = parsePackUnits(termText);
  const parsedTiers = packUnits.length > 0 ? [] : parseTiers(termText);
  const tiers = parsedTiers.length > 0 ? parsedTiers : packUnits.length === 0 && promoPrice > 0 ? [{ minQty: 1, price: promoPrice }] : [];
  const unit = packUnits.length > 0 ? packUnits[0].label : detectUnit(`${termText} ${productName}`);

  // For a packaging-unit promo, lead with whichever level is the best deal
  // per piece (the largest packaging size, in practice) rather than the flat
  // Promotion Price column, which only ever holds one number.
  const bestPackUnit = packUnits.length > 0 ? packUnits.reduce((a, b) => (avgPricePerPiece(b) < avgPricePerPiece(a) ? b : a)) : null;

  return {
    name: termText || productName,
    value: bestPackUnit
      ? `เฉลี่ยต่ำสุด ฿${avgPricePerPiece(bestPackUnit).toFixed(2)}/ชิ้น (${bestPackUnit.label} ฿${bestPackUnit.price})`
      : basePrice > promoPrice && promoPrice > 0
        ? `฿${promoPrice}/${unit} (จาก ฿${basePrice})`
        : `฿${promoPrice}/${unit}`,
    sku,
    skuName: productName,
    type: packUnits.length > 0 ? 'ราคาต่อหน่วยบรรจุ' : tiers.length > 1 ? 'ลดขั้นบันได' : 'ลดราคา',
    period: start && end ? `${start} – ${end}` : '',
    st: 'active',
    unit,
    tiers,
    packUnits,
    termText,
  };
}

export async function fetchActivePromotions(): Promise<Promo[]> {
  const rows = await fetchSheetRows(CSV_URL);
  return rows.map(rowToPromo).filter((p): p is Promo => p !== null);
}

export { CSV_URL as PROMOTIONS_CSV_URL, PROMO_UNITS };
