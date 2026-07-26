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

export interface PickItem {
  sku: string;
  name: string;
  qty: number;
  unit: string;
  loc: string;
}

export interface PickBatch {
  id: string;
  meta: string;
  items: PickItem[];
}

// ---------- Promotions ("โปรโมชั่น" tab, Active rows only) ----------
export type PromoStatus = 'active' | 'upcoming' | 'expired';

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

export interface Promo {
  name: string;
  value: string;
  sku: string;
  skuName: string;
  type: string;
  period: string;
  st: PromoStatus;
  /** Unit the promotion price applies to. */
  unit: PromoUnit;
  /** Volume steps, ascending by minQty. A single-step promo has one entry. */
  tiers: PromoTier[];
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

export type RouteKey = 'dashboard' | 'route' | 'planner' | 'driver' | 'pick' | 'cod' | 'promo' | 'grn' | 'sku' | 'customer' | 'settings';
