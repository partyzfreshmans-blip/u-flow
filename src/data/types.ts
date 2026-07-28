// ---------- COD / batch picking (unchanged — still local/mock, out of scope) ----------
export type OrderStatus = 'pending' | 'delivering' | 'delivered' | 'cleared';
export type SyncStatus = 'synced' | 'pending' | 'error';

export interface Order {
  id: string;
  cust: string;
  addr: string;
  route: 'A' | 'B';
  driver: string;
  status: OrderStatus;
  cod: boolean;
  amt: number;
  items: number;
  date: string;
  sync: SyncStatus;
}

// ---------- Promotions ("โปรโมชั่น" tab — every row, not just Active) ----------
/** Units a promotion price can be quoted per. The sheet quotes prices per
 * หีบ/ลัง most often, but singles and paired deals also occur. */
export const PROMO_UNITS = ['ชิ้น', 'คู่', 'แพ็ค', 'ลัง', 'หีบ'] as const;
export type PromoUnit = (typeof PROMO_UNITS)[number];

/** One step of a volume promotion: buy `minQty` or more, pay `price` per unit.
 * Mirrors the sheet's own wording, e.g. "ลังละ 279บาท, 5ลังขึ้นไป 275บาท,
 * 20ลังขึ้นไป 270บาท" becomes three tiers. */
export interface PromoTier {
  minQty: number;
  price: number;
}

/** One packaging level of a promotion priced per packaging unit rather than
 * by a buy-more-save-more quantity threshold — e.g. a product sold as a
 * single ชิ้น, a แพ็ค of 4 ชิ้น, and a หีบ of 24 แพ็ค, each at its own flat
 * price. Distinct from PromoTier: a tier is "buy N+ of the SAME unit, pay
 * less per unit"; a pack unit is "this is a DIFFERENT packaging size,
 * naturally priced differently because it contains more/less". */
export interface PromoPackUnit {
  /** e.g. 'ชิ้น', 'แพ็ค', 'หีบ'. */
  label: PromoUnit;
  /** Flat price for one of this packaging unit. */
  price: number;
  /** How many of the next-smaller packaging unit (or how many loose pieces,
   * for the smallest/base entry) are packed inside one of this unit. E.g.
   * แพ็ค containing 4 ชิ้น -> qtyPerUnit=4. Always >= 1. */
  qtyPerUnit: number;
}

export interface Promo {
  name: string;
  value: string;
  sku: string;
  skuName: string;
  type: string;
  period: string;
  /** Raw "Status" column text from the sheet (e.g. "Active", "Inactive") —
   * kept verbatim rather than normalized into a fixed set, since the sheet
   * is the source of truth for what values exist. */
  st: string;
  /** Unit the promotion price applies to. */
  unit: PromoUnit;
  /** Volume steps, ascending by minQty. A single-step promo has one entry.
   * Used for the "buy more, pay less per unit" style of promo (e.g. ลัง). */
  tiers: PromoTier[];
  /** Packaging-unit prices (ชิ้น/แพ็ค/หีบ, etc.), when this promo is instead
   * priced per distinct packaging size rather than by quantity threshold.
   * Empty when the promo uses `tiers` instead. */
  packUnits: PromoPackUnit[];
  /** Original free-text term from the sheet, kept verbatim so nothing the
   * parser could not interpret is lost. */
  termText: string;
}

// ---------- GRN (unchanged) ----------
export interface GrnLogEntry {
  supplier: string;
  doc: string;
  count: number;
  when: string;
  by: string;
}

export interface GrnLine {
  name: string;
  barcode: string;
  price: number;
  piece: number;
  pack: number;
  cs: number;
}

// ---------- SKU master (Google Sheet) ----------
export type SkuStatus = 'active' | 'inactive';

export interface Sku {
  /** Unique key for this row — may not match displayId when the source data
   * repeats the same catalog SKU ID across packaging-variant rows. */
  id: string;
  /** The catalog SKU ID as shown to users; can repeat across rows. */
  displayId: string;
  barcode: string;
  name: string;
  unit: string;
  stock: number;
  status: SkuStatus;
  /** Warehouse storage/bin location, e.g. "A1-02" — blank if the sheet has
   * no such column yet (it doesn't today; read defensively so this starts
   * working the moment one is added, with no further code changes). */
  location: string;
}

// ---------- Dashboard / "API Import" tab: newest, not-yet-routed orders ----------
export interface ApiImportOrder {
  no: string;
  orderUid: string;
  /** Real Thai status text from the sheet, e.g. รอยืนยันออเดอร์ / กำลังดำเนินการ /
   * รอชำระเงิน / ได้รับแล้ว / ยกเลิก — shown verbatim, not translated into an enum. */
  status: string;
  paymentType: string;
  paid: string;
  itemCount: number;
  totalAmount: number;
  customer: string;
  phone: string;
  address: string;
  district: string;
  province: string;
  orderedAt: string;
  deliveredAt: string;
  completedAt: string;
  wantsTaxInvoice: string;
  updatedAt: string;
  lat: number | null;
  lng: number | null;
}

// ---------- Route planning / delivery history: "คำสั่งซื้อ" tab ----------
export interface RouteOrder {
  /** Effective route: the manual "Route" column if set, else the "AutoR" column. */
  route: string;
  plannedDeliveryDate: string;
  orderedAtText: string;
  customer: string;
  orderNo: string;
  itemCount: number;
  totalAmount: number;
  paymentType: string;
  status: string;
  note: string;
  isNewCustomer: string;
  orderedDate: string;
  deliveredDate: string;
  completedDate: string;
  updatedDate: string;
  /** Parsed from a bootstrapped "ขอใบกำกับภาษี" column — see routeOrdersWrite.ts. */
  wantsTaxInvoice: boolean;
  /** Parsed from a bootstrapped "Archived" column — see routeOrdersWrite.ts. Hides
   * the order from normal operational views (Order Management, Planner, Pick,
   * Dashboard) without deleting any data; toggled via the archive/unarchive UI. */
  archived: boolean;
  districtProvince: string;
  addressFromUnii: string;
  mapLink: string;
  lat: number | null;
  lng: number | null;
  phone: string;
  distanceFromWhKm: number | null;
  whLat: number | null;
  whLng: number | null;
}

// ---------- Order line items: "SKU Detail" tab ----------
export interface OrderLineItem {
  no: string;
  orderNo: string;
  orderedAt: string;
  customer: string;
  sku: string;
  productName: string;
  unit: string;
  qty: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  /** SKU of the promotion this line was explicitly confirmed as using, '' if
   * none. Parsed from a bootstrapped "Promo SKU" column — see
   * skuDetailWrite.ts. Never inferred from matching price alone — only set
   * when staff explicitly confirm it for this exact line. */
  promoSku: string;
}

// ---------- Customers: "CS Master" tab (read + lat/lng write-back) ----------
export interface CsMasterCustomer {
  /** 1-based row number in the sheet (header row = 1); used to target writes. */
  rowIndex: number;
  name: string;
  phone: string;
  address: string;
  lat: number | null;
  lng: number | null;
  mapLink: string;
  wantsTaxInvoice: string;
  note: string;
}

export type RouteKey = 'dashboard' | 'route' | 'planner' | 'driver' | 'pick' | 'cod' | 'promo' | 'grn' | 'sku' | 'customer' | 'activity' | 'settings' | 'users';
