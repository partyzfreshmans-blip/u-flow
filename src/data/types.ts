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

// ---------- Order data straight from the Unii API (server/unii.ts proxies
// GET /api/orders/branch/{id} — see that file for the live shape). Used to
// be a Google Sheets "API Import" tab kept in sync with Unii by some external
// process; reading Unii directly removes that sync step and its lag
// entirely. Every field the app currently knows about is named below, plus
// `raw` holding the complete original JSON object for a field nobody has
// written code for yet, so it's still sitting in state, ready the moment
// something needs it (no re-fetch, no code change to "start capturing" it). ----------
export interface ApiImportOrder {
  no: string;
  orderUid: string;
  /** Real Thai status text from the sheet, e.g. รอยืนยันออเดอร์ / กำลังดำเนินการ /
   * รอชำระเงิน / ได้รับแล้ว / ยกเลิก — shown verbatim, not translated into an enum. */
  status: string;
  paymentType: string;
  /** Payment-received flag straight from Unii ("ชำระเงินแล้ว"), separate from
   * the order status itself — a paid order can still be "กำลังดำเนินการ". */
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
  /** Raw tax-invoice request text as Unii sent it — the app's own override
   * (see StaffOrderInfo.taxInvoiceOverride) takes precedence when staff have
   * explicitly set one; this is only the fallback/default. */
  wantsTaxInvoice: string;
  updatedAt: string;
  lat: number | null;
  lng: number | null;
  /** Distance from warehouse and the warehouse's own coordinate, if this tab
   * carries them (columns observed under these exact snake_case names,
   * unlike every other column here — apparently passed through by Unii
   * without a Thai relabel). Null when the tab doesn't have them for this row;
   * downstream code always has a haversine fallback once a customer
   * coordinate is known, so this is a "when available" optimization only. */
  distanceFromWhKm: number | null;
  whLat: number | null;
  whLng: number | null;
  /** The complete order object exactly as Unii's API returned it, including
   * every field not named above. The single guarantee this design is built
   * around: nothing Unii sends is ever silently dropped, whether or not the
   * app has a typed field for it yet. */
  raw: Record<string, unknown>;
}

// ---------- "คำสั่งซื้อ VS" tab: ONLY what staff enter through this app's own
// UI — never a copy of anything already in API Import. "เลขคำสั่งซื้อ" (the
// order number) is the sole key; a row may not exist yet for a brand new
// order, which just means none of these fields have been set (see
// joinRouteOrders). Column layout confirmed against the live sheet — see
// config/sheets.ts's STAFF_ORDER_INFO_HEADERS for the exact real header
// text/order and STAFF_READONLY_HEADERS for the two ARRAYFORMULA columns
// this app must never write. ----------
export interface StaffOrderInfo {
  orderUid: string;
  /** ISO YYYY-MM-DD once set via the "วันที่จะจัดส่ง" field, '' until then. */
  plannedDeliveryDate: string;
  note: string;
  /** null = staff never touched this — the joined order falls back to
   * ApiImportOrder.wantsTaxInvoice. Set explicitly once edited here. */
  taxInvoiceOverride: boolean | null;
  /** App-driven delivery outcome ("กำลังจัดส่ง" on pick-lot close, "ส่งสำเร็จ" on
   * mark-delivered, "ส่งไม่สำเร็จ" on a driver's failed-delivery report) —
   * written to the sheet's "ปัญหาการส่ง" column (the closest real column;
   * there's no column dedicated purely to this app's status vocabulary) —
   * kept apart from ApiImportOrder.status (Unii's own field, this app never
   * writes to it). '' until any of the three actions above has fired once. */
  operationalStatus: string;
  /** "{route}/{batchRoute}/{driver}" assembled from the sheet's separate
   * Route/BATCH ROUTE/คนส่ง columns, stamped by a Batch Route Assign/edit,
   * '' once the order leaves every batch. */
  courierStamp: string;
  archived: boolean;
  /** Free-text "new customer" annotation — an ARRAYFORMULA-driven column
   * this app has never had (and must never have) write access to; read-only
   * here purely for display. */
  newCustomer: string;
}

// ---------- Route planning / delivery history / order management: the
// runtime JOIN of ApiImportOrder + StaffOrderInfo by Order UID (see
// joinRouteOrders) — every page in the app reads this, never the two source
// types directly, so there is exactly one place "what does staff data win
// over Unii data, and vice versa" gets decided. ----------
export interface RouteOrder {
  orderedAtText: string;
  customer: string;
  orderNo: string;
  itemCount: number;
  totalAmount: number;
  paymentType: string;
  /** ApiImportOrder.status, unless StaffOrderInfo.operationalStatus has ever
   * been set (mark-delivered/delivery-failed/pick-lot-close) — that's this
   * app's own record of an outcome Unii's pipeline may not yet reflect. */
  status: string;
  plannedDeliveryDate: string;
  note: string;
  isNewCustomer: string;
  orderedDate: string;
  deliveredDate: string;
  completedDate: string;
  updatedDate: string;
  wantsTaxInvoice: boolean;
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
  /** "{driver}/{vehicle}/{batchId}" — see StaffOrderInfo.courierStamp. Not
   * currently read by any page (batch/vehicle assignment is read live off
   * state.batchRoutes instead), kept for parity with what's written. */
  courierStamp: string;
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
