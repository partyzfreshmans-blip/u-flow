// Direct read from the Unii API — replaces the old Google Sheets "API
// Import" tab as the source of order data (see src/data/types.ts's
// ApiImportOrder). UNII_API_TOKEN lives ONLY here, in a Node-only env var,
// exactly like GOOGLE_SERVICE_ACCOUNT_KEY/DATABASE_URL — never sent to the
// browser bundle.
//
// Nothing calls Unii live on a page read anymore. server/lib.ts's
// handleSyncUniiOrders — triggered on a schedule by Vercel Cron, see
// vercel.json — is now the ONLY caller of fetchAllUniiOrders below; it
// upserts the result into Postgres's unii_order_cache table (see
// db/migrations/0003_unii_order_cache.sql), and every page read goes
// straight to that table (server/lib.ts's readCachedApiImportOrders)
// instead. A Unii outage/timeout/rate-limit only ever affects the next
// sync's success, never a page load — see unii_sync_status for how a
// failed sync surfaces without ever becoming a hard page error.
//
// IMPORTANT — the exact JSON shape Unii returns has not been seen firsthand
// (this environment has no network access to mart.iinuhcet.com to sample a
// real response while writing this). mapUniiOrder below is deliberately
// defensive: for every field it tries several plausible key names/nesting
// (flat vs a nested `customer` object) rather than assuming one exact shape,
// and always keeps the complete raw object on `.raw` so nothing is lost even
// if a named field's key guess is wrong. Once this runs for real on Vercel
// (where UNII_API_TOKEN is actually set), check the `unmapped` warning this
// module logs on first fetch — it lists any of the guessed keys that came up
// empty across the whole page, which is the fastest way to spot a wrong
// guess and fix it in mapUniiOrder.
import type { ApiImportOrder } from '../src/data/types.js';

const UNII_API_BASE = 'https://mart.iinuhcet.com/api';
// The branch ID the one endpoint the app was given is scoped to. Not a
// secret — just business config — so it's a plain constant, not an env var,
// matching how MAIN_SHEET_ID/SKU_SHEET_ID are plain constants in
// src/config/sheets.ts. If this app ever needs to read more than one branch,
// this is the one line to change (or promote to an env var).
const UNII_BRANCH_ID = '584';

// Requested params match the endpoint the app was given, except limit (bumped
// from the example's 25 to cut the number of page round-trips) and page
// (looped below).
const PAGE_LIMIT = 100;
// Safety cap on how many pages one fetch cycle will walk — 40 pages * 100 =
// 4,000 orders. If a branch has more open+recent history than that, this
// stops short rather than risking a serverless function timeout; see the
// "endpoints we may still need" note in the handoff summary for what a
// dedicated historical-backfill endpoint would need to look like.
const MAX_PAGES = 40;
const REQUEST_TIMEOUT_MS = 8_000;

let loggedUnmappedWarning = false;

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const parts = key.split('.');
    let cur: unknown = obj;
    for (const part of parts) {
      if (cur == null || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return undefined;
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string {
  const v = pick(obj, keys);
  if (v == null) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

function pickNum(obj: Record<string, unknown>, keys: string[]): number {
  const v = pick(obj, keys);
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/,/g, '')) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function pickLatLng(obj: Record<string, unknown>, keys: string[]): number | null {
  const v = pick(obj, keys);
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Normalizes a boolean-or-Thai-text tax-invoice/paid flag into the same
 * Thai yes-text the old Sheet used ('ใช่' / ''), since downstream parsing
 * (parseYesNo in routeOrders.ts, etc.) already expects that exact shape. */
function pickYesNoText(obj: Record<string, unknown>, keys: string[]): string {
  const v = pick(obj, keys);
  if (typeof v === 'boolean') return v ? 'ใช่' : '';
  if (typeof v === 'string') return v.trim();
  return '';
}

// Before this app read Unii directly, order data came from a Google Sheet
// tab literally called "API Import" — populated by Unii's own integration,
// under these exact Thai/mixed column headers (see the pre-migration
// src/data/sources/apiImportOrders.ts, still in git history at commit
// f08b120). Since that Sheet's data ultimately came from Unii in the first
// place, its column names are a much stronger signal for what Unii's raw
// API JSON keys actually are than a blind camelCase/snake_case guess — so
// they're tried first, ahead of the original guesses (kept as a fallback
// in case Unii's API shape differs from what it once pushed into Sheets).
const FIELD_KEY_CANDIDATES = {
  orderUid: ['Order UID', 'orderUid', 'order_uid', 'uid', 'orderNo', 'order_no', 'orderNumber', 'orderCode', 'id'],
  no: ['No', 'no', 'orderIndex', 'runningNo'],
  status: ['สถานะ', 'status', 'orderStatus', 'statusText', 'status_text'],
  paymentType: ['ประเภทชำระเงิน', 'paymentType', 'payment_type', 'paymentMethod', 'payment_method'],
  paid: ['ชำระเงินแล้ว', 'paid', 'isPaid', 'paymentStatus', 'payment_status'],
  itemCount: ['จำนวนรายการ', 'itemCount', 'item_count', 'totalItems', 'total_items'],
  totalAmount: ['ยอดขายรวม', 'totalAmount', 'total_amount', 'total', 'grandTotal', 'grand_total', 'netTotal', 'net_total'],
  customer: ['ลูกค้า', 'customer.name', 'customerName', 'customer_name', 'receiver.name', 'name'],
  phone: ['เบอร์โทร', 'customer.phone', 'customerPhone', 'customer_phone', 'phone', 'receiver.phone', 'tel'],
  address: ['ที่อยู่', 'customer.address', 'address', 'shippingAddress', 'shipping_address', 'deliveryAddress', 'delivery_address'],
  district: ['อำเภอ', 'customer.district', 'district', 'amphoe', 'customer.amphoe'],
  province: ['จังหวัด', 'customer.province', 'province', 'changwat', 'customer.changwat'],
  orderedAt: ['วันที่สั่ง', 'orderedAt', 'ordered_at', 'createdAt', 'created_at'],
  deliveredAt: ['วันที่จัดส่ง', 'deliveredAt', 'delivered_at', 'shippedAt', 'shipped_at'],
  completedAt: ['วันที่ส่งสำเร็จ', 'completedAt', 'completed_at', 'finishedAt', 'finished_at'],
  updatedAt: ['วันที่อัปเดต', 'updatedAt', 'updated_at'],
  wantsTaxInvoice: ['ขอใบกำกับภาษี', 'wantsTaxInvoice', 'wants_tax_invoice', 'taxInvoice', 'tax_invoice', 'requestTaxInvoice'],
  lat: ['Latitude', 'lat', 'latitude', 'customer.lat', 'customer.latitude'],
  lng: ['Longitude', 'lng', 'lon', 'long', 'longitude', 'customer.lng', 'customer.longitude'],
  distanceFromWhKm: ['far_from_wh', 'distanceFromWh', 'distance_from_wh'],
  whLat: ['wh_lat', 'whLat'],
  whLng: ['wh_long', 'wh_lng', 'whLng'],
} as const;

/** Maps one raw Unii order object into the app's ApiImportOrder shape — see
 * this file's header comment for why every field tries several candidate
 * keys instead of trusting one exact name. Returns null only when no
 * plausible order-identifier field was found at all (nothing usable to key
 * this order by downstream). */
function mapUniiOrder(raw: unknown, unmapped: Set<string>): ApiImportOrder | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const orderUid = pickStr(o, [...FIELD_KEY_CANDIDATES.orderUid]);
  if (!orderUid) return null;

  for (const [field, keys] of Object.entries(FIELD_KEY_CANDIDATES)) {
    if (pick(o, [...keys]) === undefined) unmapped.add(field);
  }

  return {
    no: pickStr(o, [...FIELD_KEY_CANDIDATES.no]) || orderUid,
    orderUid,
    status: pickStr(o, [...FIELD_KEY_CANDIDATES.status]),
    paymentType: pickStr(o, [...FIELD_KEY_CANDIDATES.paymentType]),
    paid: pickYesNoText(o, [...FIELD_KEY_CANDIDATES.paid]),
    itemCount: pickNum(o, [...FIELD_KEY_CANDIDATES.itemCount]),
    totalAmount: pickNum(o, [...FIELD_KEY_CANDIDATES.totalAmount]),
    customer: pickStr(o, [...FIELD_KEY_CANDIDATES.customer]),
    phone: pickStr(o, [...FIELD_KEY_CANDIDATES.phone]),
    address: pickStr(o, [...FIELD_KEY_CANDIDATES.address]),
    district: pickStr(o, [...FIELD_KEY_CANDIDATES.district]),
    province: pickStr(o, [...FIELD_KEY_CANDIDATES.province]),
    orderedAt: pickStr(o, [...FIELD_KEY_CANDIDATES.orderedAt]),
    deliveredAt: pickStr(o, [...FIELD_KEY_CANDIDATES.deliveredAt]),
    completedAt: pickStr(o, [...FIELD_KEY_CANDIDATES.completedAt]),
    wantsTaxInvoice: pickYesNoText(o, [...FIELD_KEY_CANDIDATES.wantsTaxInvoice]),
    updatedAt: pickStr(o, [...FIELD_KEY_CANDIDATES.updatedAt]),
    lat: pickLatLng(o, [...FIELD_KEY_CANDIDATES.lat]),
    lng: pickLatLng(o, [...FIELD_KEY_CANDIDATES.lng]),
    distanceFromWhKm: pickLatLng(o, [...FIELD_KEY_CANDIDATES.distanceFromWhKm]),
    whLat: pickLatLng(o, [...FIELD_KEY_CANDIDATES.whLat]),
    whLng: pickLatLng(o, [...FIELD_KEY_CANDIDATES.whLng]),
    raw: o,
  };
}

/** Finds the array of order objects inside an unknown response envelope —
 * tries the common container keys before giving up, since Unii's exact
 * envelope shape (`data`/`orders`/`items`/`results`/`rows`, or maybe no
 * envelope at all) hasn't been observed directly. */
function extractOrdersArray(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  for (const key of ['data', 'orders', 'items', 'results', 'rows']) {
    const v = b[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray((v as Record<string, unknown>).data)) {
      return (v as Record<string, unknown>).data as unknown[];
    }
  }
  return null;
}

function classifyHttpError(status: number, bodyText: string): string {
  if (status === 401 || status === 403) return 'Unii API token ไม่ถูกต้องหรือหมดอายุ (401/403)';
  if (status === 429) return 'Unii API จำกัดจำนวนคำขอ (rate limit) ลองใหม่อีกครั้งภายหลัง';
  // Distinct from this app's own 404 (a route/deployment problem in THIS
  // backend) — this one means Unii itself couldn't find the endpoint we
  // called, which points at the URL/branch id in server/unii.ts's
  // UNII_API_BASE/UNII_BRANCH_ID being wrong or Unii having changed it.
  if (status === 404) return `Unii API ไม่พบ endpoint ที่เรียก (HTTP 404) — ตรวจสอบว่า URL/branch id ที่เรียก (${UNII_API_BASE}/orders/branch/${UNII_BRANCH_ID}) ยังถูกต้องอยู่ฝั่ง Unii`;
  if (status >= 500) return `Unii API มีปัญหาฝั่งเซิร์ฟเวอร์ (HTTP ${status})`;
  return `Unii API ตอบกลับผิดพลาด (HTTP ${status})${bodyText ? `: ${bodyText.slice(0, 200)}` : ''}`;
}

async function fetchUniiPage(token: string, page: number): Promise<unknown[]> {
  const url =
    `${UNII_API_BASE}/orders/branch/${UNII_BRANCH_ID}` +
    `?page=${page}&limit=${PAGE_LIMIT}&inStockFirst=true&showOutOfStock=true&showDiscontinued=true&sortBy=createdAt%3Adesc`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } catch (err: unknown) {
    const message = err instanceof Error && err.name === 'AbortError' ? 'หมดเวลาเชื่อมต่อ Unii API' : 'เชื่อมต่อ Unii API ไม่ได้';
    throw new Error(message);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(classifyHttpError(res.status, bodyText));
  }

  const body: unknown = await res.json().catch(() => null);
  const orders = extractOrdersArray(body);
  if (orders === null) {
    throw new Error('Unii API ตอบกลับในรูปแบบที่ไม่รู้จัก — หา array ของออเดอร์ในผลลัพธ์ไม่พบ');
  }
  return orders;
}

/** Fetches every Unii order across as many pages as fit in the time budget
 * below, mapped to ApiImportOrder. The only caller is server/lib.ts's
 * handleSyncUniiOrders (the cron-triggered sync) — this always talks to
 * Unii live, no caching of its own, since the caller is itself the thing
 * responsible for freshness on a schedule; Postgres (unii_order_cache) is
 * the one persisted cache every page read actually goes through. Throws on
 * failure (missing token, network/timeout, an error status from Unii, or an
 * unrecognized response shape) — the sync handler is what decides how a
 * failure surfaces (see unii_sync_status), not this function. */
export async function fetchAllUniiOrders(): Promise<ApiImportOrder[]> {
  const token = process.env.UNII_API_TOKEN?.trim();
  if (!token) throw new Error('UNII_API_TOKEN ไม่ได้ตั้งค่าไว้');

  const unmapped = new Set<string>();
  const mapped: ApiImportOrder[] = [];
  const deadline = Date.now() + 25_000; // overall pagination time budget

  for (let page = 1; page <= MAX_PAGES; page++) {
    const rawPage = await fetchUniiPage(token, page);
    for (const raw of rawPage) {
      const order = mapUniiOrder(raw, unmapped);
      if (order) mapped.push(order);
    }
    if (rawPage.length < PAGE_LIMIT) break; // last page
    if (Date.now() > deadline) {
      console.warn(`[unii] stopped paginating early at page ${page} (time budget) — some older orders may be missing this cycle`);
      break;
    }
  }

  if (!loggedUnmappedWarning && mapped.length > 0) {
    loggedUnmappedWarning = true;
    if (unmapped.size > 0) {
      console.warn(
        `[unii] these ApiImportOrder fields never matched any candidate key across the first fetch — check server/unii.ts's FIELD_KEY_CANDIDATES against the real response shape: ${Array.from(unmapped).join(', ')}`,
      );
    }
  }

  return mapped;
}

