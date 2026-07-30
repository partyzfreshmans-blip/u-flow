// One-off data migration: copies the current Google Sheets content into the
// Postgres schema from db/migrations/0001_init.sql. Run this once (or as
// many times as needed while verifying — see "Idempotency" below) BEFORE any
// future phase switches the live app's read/write paths over to Postgres.
// Nothing in server/lib.ts or api/*.ts is touched or imported for writing —
// this script only READS Google Sheets and WRITES Postgres; the live app
// keeps working against Sheets exactly as before, and nothing here deletes
// or modifies a single cell in the source spreadsheet.
//
// Requires two environment variables (loaded from .env if present, same as
// every other script in this repo):
//   GOOGLE_SERVICE_ACCOUNT_KEY — same credential server/lib.ts already uses
//   DATABASE_URL               — the Postgres connection string (see
//                                 db/README.md for how to get one)
//
// Run with: npx tsx scripts/migrate-to-postgres.ts
//
// Idempotency: every table this script writes to is fully replaced on each
// run — TRUNCATE, then re-insert everything freshly read from Sheets, all in
// one transaction (rolled back automatically if anything fails partway).
// Google Sheets remains the single source of truth for these tables during
// this phase, so "replace with a fresh copy" is both simpler and more
// correct than trying to diff/merge — there is no independent Postgres-side
// data yet to preserve (see db/README.md: nothing writes to Postgres in
// production). Re-running after fixing a Sheets typo, or after this script
// itself changes, is exactly the scenario this is designed for. The one
// side effect of this approach: created_at/updated_at columns reflect the
// most recent migration run, not any original historical timestamp — Sheets
// itself doesn't record row-creation times for most of these tabs either, so
// there is no better source to use.
import 'dotenv/config';
import { google } from 'googleapis';
import Papa from 'papaparse';
import { getDb } from '../server/db.js';

const MAIN_SHEET_ID = '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
const SKU_SHEET_ID = '1gfbuVcH88ugwXgar393voAfcdOsS_qoi9galIFbWNXM';

const GIDS = {
  apiImport: '665542805',
  routeOrders: '848682054', // "คำสั่งซื้อ VS" — staff-entered fields only
  skuDetail: '772187603',
  promotions: '1999566312',
  csMaster: '514841442',
  skuMaster: '0', // in SKU_SHEET_ID, not MAIN_SHEET_ID
};

function csvExportUrl(sheetId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
}

// ---------------------------------------------------------------------------
// Report — accumulates what happened per table so the final printout matches
// what was asked for: rows migrated, and anything skipped/errored with why.
// ---------------------------------------------------------------------------
interface TableReport {
  table: string;
  migrated: number;
  skipped: { reason: string; count: number }[];
  notes: string[];
}
const report: TableReport[] = [];
function newReport(table: string): TableReport {
  const r: TableReport = { table, migrated: 0, skipped: [], notes: [] };
  report.push(r);
  return r;
}
function addSkip(r: TableReport, reason: string, count = 1) {
  const existing = r.skipped.find((s) => s.reason === reason);
  if (existing) existing.count += count;
  else r.skipped.push({ reason, count });
}

// ---------------------------------------------------------------------------
// Extract: Google Sheets readers. CSV export (no auth needed, same as the
// frontend's own reads) for tabs the app already reads that way; the
// authenticated Sheets API (same Service Account server/lib.ts uses) for
// Users/Bookings/Batch Routes, which are never CSV-exported client-side
// because Users holds password hashes.
// ---------------------------------------------------------------------------
async function fetchCsvRows(url: string): Promise<Record<string, string>[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV export failed (HTTP ${res.status}) for ${url}`);
  const text = await res.text();
  return Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true }).data;
}

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw || raw.trim() === '') throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set');
  const creds = JSON.parse(raw);
  if (!creds.client_email || !creds.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must have client_email and private_key');
  return { client_email: creds.client_email as string, private_key: (creds.private_key as string).replace(/\\n/g, '\n') };
}

async function getSheetsClient() {
  const { client_email, private_key } = getServiceAccountCredentials();
  const auth = new google.auth.JWT({ email: client_email, key: private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}
type SheetsClient = Awaited<ReturnType<typeof getSheetsClient>>;

/** Read-only tab existence check — deliberately does NOT create the tab if
 * missing (unlike server/lib.ts's ensureXSheet helpers, which also seed
 * throwaway test accounts into a fresh Users tab). A migration script must
 * never have that kind of write side effect on the source spreadsheet. */
async function readAuthedTab(sheets: SheetsClient, tabTitle: string, range: string): Promise<string[][] | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === tabTitle);
  if (!exists) return null;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${tabTitle}!${range}` });
  return (res.data.values ?? []) as string[][];
}

function toNumber(v: string | undefined): number {
  const cleaned = (v ?? '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function toFloatOrNull(v: string | undefined): number | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function blankToNull(s: string): string | null {
  return s.trim() === '' ? null : s.trim();
}
function parseYesNo(text: string): boolean {
  return /^(ใช่|yes|true|y)$/i.test(text.trim());
}
function parseTriStateBool(v: string | undefined): boolean | null {
  const s = (v ?? '').trim();
  if (!s) return null;
  return /^(ใช่|yes|true|y)$/i.test(s);
}
/** "DD-MM-YYYY" (the โปรโมชั่น tab's own date format — confirmed against
 * real rows in scripts/seed-promotions.mjs) -> "YYYY-MM-DD", or null if the
 * cell is blank/unparseable. */
function promoSheetDateToIso(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  const [, day, month, year] = m;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// ---- API Import (raw Unii order data) --------------------------------------
interface ApiImportRow {
  orderUid: string;
  customer: string;
  phone: string;
  address: string;
  lat: number | null;
  lng: number | null;
}
async function extractApiImport(): Promise<ApiImportRow[]> {
  const rows = await fetchCsvRows(csvExportUrl(MAIN_SHEET_ID, GIDS.apiImport));
  return rows
    .map((row): ApiImportRow | null => {
      const orderUid = (row['Order UID'] ?? '').trim();
      if (!orderUid) return null;
      return {
        orderUid,
        customer: (row['ลูกค้า'] ?? '').trim(),
        phone: (row['เบอร์โทร'] ?? '').trim(),
        address: (row['ที่อยู่'] ?? '').trim(),
        lat: toFloatOrNull(row['Latitude']),
        lng: toFloatOrNull(row['Longitude']),
      };
    })
    .filter((r): r is ApiImportRow => r !== null);
}

// ---- คำสั่งซื้อ VS (staff-entered order data) -------------------------------
interface StaffOrderRow {
  orderUid: string;
  plannedDeliveryDate: string;
  note: string;
  taxInvoiceOverride: boolean | null;
  operationalStatus: string;
  courierStamp: string;
  archived: boolean;
}
async function extractStaffOrderInfo(): Promise<StaffOrderRow[]> {
  const rows = await fetchCsvRows(csvExportUrl(MAIN_SHEET_ID, GIDS.routeOrders));
  return rows
    .map((row): StaffOrderRow | null => {
      const orderUid = (row['Order UID'] ?? '').trim();
      if (!orderUid) return null;
      return {
        orderUid,
        plannedDeliveryDate: (row['วันที่จะจัดส่ง'] ?? '').trim(),
        note: (row['หมายเหตุ'] ?? '').trim(),
        taxInvoiceOverride: parseTriStateBool(row['ขอใบกำกับภาษี']),
        operationalStatus: (row['สถานะการดำเนินงาน'] ?? '').trim(),
        courierStamp: (row['คนส่ง'] ?? '').trim(),
        archived: parseYesNo(row['Archived'] ?? ''),
      };
    })
    .filter((r): r is StaffOrderRow => r !== null);
}

// ---- CS Master (customer overrides) ----------------------------------------
interface CsMasterRow {
  name: string;
  phone: string;
  address: string;
  lat: number | null;
  lng: number | null;
}
async function extractCsMaster(): Promise<CsMasterRow[]> {
  const rows = await fetchCsvRows(csvExportUrl(MAIN_SHEET_ID, GIDS.csMaster));
  return rows
    .map((row): CsMasterRow | null => {
      const name = (row['ชื่อ'] ?? '').trim();
      const phone = (row['เบอร์'] ?? '').trim();
      if (!name && !phone) return null;
      return { name, phone, address: (row['ที่อยู่'] ?? '').trim(), lat: toFloatOrNull(row['ละ']), lng: toFloatOrNull(row['ลอง']) };
    })
    .filter((r): r is CsMasterRow => r !== null);
}

// ---- SKU Master -------------------------------------------------------------
interface SkuMasterRow {
  skuId: string;
  barcode: string;
  name: string;
  unit: string;
  stock: number;
  status: 'active' | 'inactive';
  location: string;
}
function cleanBarcode(...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    const v = (c ?? '').trim();
    if (v && v !== '-' && v !== '\\-') return v;
  }
  return '';
}
function cleanUnit(rawUnit: string, name: string): string {
  const u = rawUnit.trim();
  if (!u) return '-';
  const parenIdx = name.indexOf('(');
  const base = (parenIdx === -1 ? name : name.slice(0, parenIdx)).trim();
  if (base && u.startsWith(base)) return u.slice(base.length).trim() || 'ชิ้น';
  return u;
}
async function extractSkuMaster(): Promise<SkuMasterRow[]> {
  const rows = await fetchCsvRows(csvExportUrl(SKU_SHEET_ID, GIDS.skuMaster));
  return rows
    .map((row): SkuMasterRow | null => {
      const skuId = (row['SKU ID'] ?? '').trim();
      const name = (row['ชื่อสินค้า (Product Name)'] ?? '').trim();
      if (!skuId && !name) return null;
      const unit = (row['หน่วยสินค้า (Unit)'] ?? '').trim();
      const stockRaw = (row['สต็อกปัจจุบัน (Stock)'] ?? '').trim();
      const inStock = (row['สถานะในสต็อก (In Stock)'] ?? '').trim();
      const location = (row['ตำแหน่งจัดเก็บ'] ?? row['ตำแหน่ง (Location)'] ?? row['Location'] ?? row['ที่จัดเก็บ'] ?? '').trim();
      const displayName = name || unit || skuId;
      return {
        skuId,
        barcode: cleanBarcode(row['Barcode'], row['บาร์โค้ด (Barcode)']),
        name: displayName,
        unit: cleanUnit(unit, displayName),
        stock: stockRaw ? Number(stockRaw.replace(/[^0-9.-]/g, '')) || 0 : 0,
        status: inStock === 'หมด' ? 'inactive' : 'active',
        location,
      };
    })
    .filter((r): r is SkuMasterRow => r !== null);
}

// ---- Promotions --------------------------------------------------------------
interface PromotionRow {
  sku: string;
  status: string;
  productName: string;
  termText: string;
  start: string | null;
  end: string | null;
  periodDays: number | null;
  promotionPrice: number | null;
  boxPrice: number | null;
  singlePrice: number | null;
}
async function extractPromotions(): Promise<PromotionRow[]> {
  const rows = await fetchCsvRows(csvExportUrl(MAIN_SHEET_ID, GIDS.promotions));
  return rows
    .map((row): PromotionRow | null => {
      const sku = (row['SKU'] ?? '').trim();
      if (!sku) return null;
      const periodRaw = (row['Period (วัน)'] ?? '').trim();
      return {
        sku,
        status: (row['Status'] ?? '').trim() || 'Active',
        productName: (row['Product Name'] ?? '').trim(),
        termText: (row['Promotion Term'] ?? '').trim(),
        start: promoSheetDateToIso(row['เริ่มโปร'] ?? ''),
        end: promoSheetDateToIso(row['สินสุด'] ?? ''),
        periodDays: periodRaw ? Number(periodRaw) || null : null,
        promotionPrice: row['Promotion Price'] ? toNumber(row['Promotion Price']) : null,
        boxPrice: row['Box Price'] ? toNumber(row['Box Price']) : null,
        singlePrice: row['Single Price'] ? toNumber(row['Single Price']) : null,
      };
    })
    .filter((r): r is PromotionRow => r !== null);
}

// ---- SKU Detail (order line items) ------------------------------------------
interface LineItemRow {
  orderNo: string;
  lineNo: string;
  sku: string;
  productName: string;
  unit: string;
  qty: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  promoSku: string;
}
async function extractOrderLineItems(): Promise<LineItemRow[]> {
  const rows = await fetchCsvRows(csvExportUrl(MAIN_SHEET_ID, GIDS.skuDetail));
  return rows
    .map((row): LineItemRow | null => {
      const orderNo = (row['เลขคำสั่งซื้อ'] ?? '').trim();
      const sku = (row['SKU'] ?? '').trim();
      if (!orderNo || !sku) return null;
      return {
        orderNo,
        lineNo: (row['No.'] ?? '').trim(),
        sku,
        productName: (row['ชื่อสินค้า'] ?? '').trim(),
        unit: (row['หน่วย'] ?? '').trim(),
        qty: toNumber(row['จำนวน']),
        unitPrice: toNumber(row['ราคา/หน่วย']),
        discount: toNumber(row['ส่วนลด']),
        lineTotal: toNumber(row['ยอดรวมรายการ']),
        promoSku: (row['Promo SKU'] ?? '').trim(),
      };
    })
    .filter((r): r is LineItemRow => r !== null);
}

// ---- Users (Service Account read; mirrors server/lib.ts's readUsers) --------
interface UserRow {
  username: string;
  passwordHash: string;
  role: string;
  active: boolean;
  driverVehicleId: string;
  createdAt: string;
}
async function extractUsers(sheets: SheetsClient): Promise<UserRow[] | null> {
  const rows = await readAuthedTab(sheets, 'Users', 'A:F');
  if (rows === null) return null;
  const out: UserRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const username = String(r[0] ?? '').trim();
    if (!username) continue;
    out.push({
      username,
      passwordHash: String(r[1] ?? ''),
      role: String(r[2] ?? '').trim(),
      active: String(r[3] ?? '').trim().toUpperCase() === 'TRUE',
      driverVehicleId: String(r[4] ?? '').trim(),
      createdAt: String(r[5] ?? '').trim(),
    });
  }
  return out;
}

// ---- Bookings (Service Account read; mirrors server/lib.ts's readBookings) -
interface BookingRow {
  orderNo: string;
  driverUsername: string;
  driverVehicleId: string;
  status: string;
  bookedAt: string;
  decidedBy: string;
  decidedAt: string;
  note: string;
}
async function extractBookings(sheets: SheetsClient): Promise<BookingRow[] | null> {
  const rows = await readAuthedTab(sheets, 'Bookings', 'A:H');
  if (rows === null) return null;
  const out: BookingRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const orderNo = String(r[0] ?? '').trim();
    if (!orderNo) continue;
    const status = String(r[3] ?? '').trim();
    out.push({
      orderNo,
      driverUsername: String(r[1] ?? '').trim(),
      driverVehicleId: String(r[2] ?? '').trim(),
      status: status === 'confirmed' || status === 'rejected' ? status : 'pending',
      bookedAt: String(r[4] ?? '').trim(),
      decidedBy: String(r[5] ?? '').trim(),
      decidedAt: String(r[6] ?? '').trim(),
      note: String(r[7] ?? '').trim(),
    });
  }
  return out;
}

// ---- Batch Routes (Service Account read; mirrors readBatchRoutes) ----------
interface BatchRouteRow {
  id: string;
  vehicleId: string;
  vehicleName: string;
  deliveryDate: string;
  orderNos: string[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  locked: boolean;
  codClosed: boolean;
  codClosedAt: string;
  codClosedBy: string;
  cancelled: boolean;
  cancelledAt: string;
  cancelledBy: string;
}
async function extractBatchRoutes(sheets: SheetsClient): Promise<BatchRouteRow[] | null> {
  const rows = await readAuthedTab(sheets, 'Batch Routes', 'A:P');
  if (rows === null) return null;
  const out: BatchRouteRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const id = String(r[0] ?? '').trim();
    if (!id) continue;
    out.push({
      id,
      vehicleId: String(r[1] ?? '').trim(),
      vehicleName: String(r[2] ?? '').trim(),
      deliveryDate: String(r[3] ?? '').trim(),
      orderNos: String(r[4] ?? '').split('|').map((s) => s.trim()).filter(Boolean),
      createdAt: String(r[5] ?? '').trim(),
      createdBy: String(r[6] ?? '').trim(),
      updatedAt: String(r[7] ?? '').trim(),
      updatedBy: String(r[8] ?? '').trim(),
      locked: String(r[9] ?? '').trim().toUpperCase() === 'TRUE',
      codClosed: String(r[10] ?? '').trim().toUpperCase() === 'TRUE',
      codClosedAt: String(r[11] ?? '').trim(),
      codClosedBy: String(r[12] ?? '').trim(),
      cancelled: String(r[13] ?? '').trim().toUpperCase() === 'TRUE',
      cancelledAt: String(r[14] ?? '').trim(),
      cancelledBy: String(r[15] ?? '').trim(),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orchestration — takes an already-authenticated Sheets client so tests can
// inject a fake one instead of requiring a real GOOGLE_SERVICE_ACCOUNT_KEY.
// Returns the report array (also used by the "print at the end" step below).
// ---------------------------------------------------------------------------
export async function runMigration(sheets: SheetsClient): Promise<TableReport[]> {
  report.length = 0; // reset — lets a test harness call this more than once in one process

  console.log('Reading Google Sheets…');
  const [apiImport, staffOrders, csMaster, skuMaster, promotions, lineItems, users, bookings, batchRoutes] = await Promise.all([
    extractApiImport(),
    extractStaffOrderInfo(),
    extractCsMaster(),
    extractSkuMaster(),
    extractPromotions(),
    extractOrderLineItems(),
    extractUsers(sheets),
    extractBookings(sheets),
    extractBatchRoutes(sheets),
  ]);
  console.log(
    `  API Import: ${apiImport.length} rows | คำสั่งซื้อ VS: ${staffOrders.length} rows | CS Master: ${csMaster.length} rows | ` +
      `SKU Master: ${skuMaster.length} rows | Promotions: ${promotions.length} rows | SKU Detail: ${lineItems.length} rows | ` +
      `Users: ${users?.length ?? '(tab not found)'} | Bookings: ${bookings?.length ?? '(tab not found)'} | Batch Routes: ${batchRoutes?.length ?? '(tab not found)'}`,
  );

  // ---- Transform: sku_master ----
  newReport('sku_master');
  const skuMasterOut = skuMaster.map((s) => [s.skuId, s.barcode, s.name, s.unit, s.stock, s.status, s.location]);

  // ---- Transform: promotions ----
  const promoRep = newReport('promotions');
  const promoBySku = new Map<string, PromotionRow>();
  for (const p of promotions) {
    if (promoBySku.has(p.sku)) addSkip(promoRep, 'duplicate SKU in โปรโมชั่น tab — kept the last row seen');
    promoBySku.set(p.sku, p); // last one wins, same dedup rule as customers/batch routes below
  }
  const promotionsOut = [...promoBySku.values()].map((p) => [
    p.sku, p.sku, p.productName, p.status, p.termText, p.start, p.end, p.periodDays, p.promotionPrice, p.boxPrice, p.singlePrice,
  ]);
  const validPromoSkus = new Set(promoBySku.keys());

  // ---- Transform: customers (CS Master overrides + API Import raw data, joined by phone) ----
  const custRep = newReport('customers');
  const rawByPhone = new Map<string, { name: string; address: string; lat: number | null; lng: number | null }>();
  for (const o of apiImport) {
    if (!o.phone) continue;
    // Rows are appended chronologically in Unii's export, so the LAST row
    // seen for a phone is its most recent known raw data.
    rawByPhone.set(o.phone, { name: o.customer, address: o.address, lat: o.lat, lng: o.lng });
  }
  const overrideByPhone = new Map<string, CsMasterRow>();
  let csMasterDupes = 0;
  for (const c of csMaster) {
    if (!c.phone) continue;
    if (overrideByPhone.has(c.phone)) csMasterDupes++;
    overrideByPhone.set(c.phone, c); // last row wins — see db/README.md: CS Master has no enforced uniqueness today
  }
  if (csMasterDupes > 0) addSkip(custRep, 'duplicate phone number in CS Master — merged into one customer row (last row won)', csMasterDupes);
  const allPhones = new Set<string>([...rawByPhone.keys(), ...overrideByPhone.keys()]);
  const customersOut = [...allPhones].map((phone) => {
    const raw = rawByPhone.get(phone);
    const override = overrideByPhone.get(phone);
    return [
      phone,
      raw?.name ?? '',
      override && override.name && override.name !== raw?.name ? override.name : null,
      raw?.lat ?? null,
      raw?.lng ?? null,
      override?.lat ?? null,
      override?.lng ?? null,
      raw?.address ?? override?.address ?? '',
    ];
  });
  custRep.notes.push('lat/lng_from_unii backfilled from the first order seen for each phone in API Import — see db/README.md for why this pair has no direct 1:1 sheet source.');

  // ---- Transform: batch_routes ----
  const batchRep = newReport('batch_routes');
  const batchRoutesOut = (batchRoutes ?? []).map((b) => [
    b.id, b.vehicleId, b.vehicleName, blankToNull(b.deliveryDate), b.createdAt || null, b.createdBy,
    b.updatedAt || null, b.updatedBy, b.locked, b.codClosed, blankToNull(b.codClosedAt), b.codClosedBy,
    b.cancelled, blankToNull(b.cancelledAt), b.cancelledBy,
  ]);
  const validBatchIds = new Set((batchRoutes ?? []).map((b) => b.id));
  const batchById = new Map((batchRoutes ?? []).map((b) => [b.id, b]));
  if (batchRoutes === null) batchRep.notes.push('"Batch Routes" tab not found in the spreadsheet — nothing to migrate (0 batches ever assigned yet, or the tab has a different name).');

  // ---- Transform: users ----
  const usersRep = newReport('users');
  const VALID_ROLES = new Set(['administrator', 'manager', 'admin_staff', 'checker', 'picker', 'driver']);
  const usersOut: unknown[][] = [];
  for (const u of users ?? []) {
    if (!VALID_ROLES.has(u.role)) {
      addSkip(usersRep, `unknown role "${u.role}" (not one of administrator/manager/admin_staff/checker/picker/driver)`);
      continue;
    }
    usersOut.push([u.username, u.passwordHash, u.role, u.active, u.driverVehicleId, blankToNull(u.createdAt)]);
  }
  if (users === null) usersRep.notes.push('"Users" tab not found in the spreadsheet — nothing to migrate.');

  // ---- Transform: orders (API Import ∪ StaffOrderInfo, joined by Order UID) ----
  const ordersRep = newReport('orders');
  const staffByUid = new Map(staffOrders.map((s) => [s.orderUid, s]));
  const apiImportByUid = new Map(apiImport.map((o) => [o.orderUid, o]));
  const allOrderUids = new Set<string>([...apiImportByUid.keys(), ...staffByUid.keys()]);
  const ordersOut: unknown[][] = [];
  let noPhoneCount = 0;
  let unknownBatchCount = 0;
  for (const orderUid of allOrderUids) {
    const api = apiImportByUid.get(orderUid);
    const staff = staffByUid.get(orderUid);
    const phone = api?.phone || null;
    if (!phone) noPhoneCount++;

    // courierStamp is "{driver} / {vehicleName} / {batchId}" — see
    // src/data/types.ts's StaffOrderInfo.courierStamp and server/lib.ts's
    // handleUpdateRouteOrder (the only place that writes it).
    let assignedDriver = '';
    let route = '';
    let batchRouteId: string | null = null;
    let assignedAt: string | null = null;
    const stamp = (staff?.courierStamp ?? '').trim();
    if (stamp) {
      const parts = stamp.split('/').map((s) => s.trim());
      assignedDriver = parts[0] ?? '';
      route = parts[1] ?? '';
      const candidateBatchId = parts[2] ?? '';
      if (candidateBatchId && validBatchIds.has(candidateBatchId)) {
        batchRouteId = candidateBatchId;
        assignedAt = batchById.get(candidateBatchId)?.updatedAt || batchById.get(candidateBatchId)?.createdAt || null;
      } else if (candidateBatchId) {
        unknownBatchCount++;
      }
    }

    ordersOut.push([
      orderUid,
      phone,
      route,
      batchRouteId,
      blankToNull(staff?.plannedDeliveryDate ?? ''),
      staff?.note ?? '',
      staff?.taxInvoiceOverride ?? null,
      null, // promotion_id — see notes below
      staff?.operationalStatus ?? '',
      '', // delivery_issue_note — no Sheets source (localStorage-only DeliveryFailureRecord.note)
      assignedDriver,
      assignedAt,
      staff?.archived ?? false,
    ]);
  }
  if (noPhoneCount > 0) addSkip(ordersRep, 'no phone number on the matching API Import row — customer_phone left NULL', noPhoneCount);
  if (unknownBatchCount > 0) addSkip(ordersRep, 'คนส่ง column references a batch ID not found in the Batch Routes tab — batch_route_id left NULL', unknownBatchCount);
  ordersRep.notes.push('promotion_id left NULL for every migrated order: the app tracks promotion usage per LINE ITEM (order_line_items.promo_sku), not per order — see db/README.md.');
  ordersRep.notes.push('assigned_at approximated from its batch route\'s updated_at/created_at — คำสั่งซื้อ VS has no dedicated "assigned at" timestamp of its own.');

  // ---- Transform: order_line_items ----
  const lineRep = newReport('order_line_items');
  const validOrderUids = new Set(allOrderUids);
  const lineItemsOut: unknown[][] = [];
  let orphanLineCount = 0;
  let unknownPromoCount = 0;
  for (const li of lineItems) {
    if (!validOrderUids.has(li.orderNo)) {
      orphanLineCount++;
      continue;
    }
    let promoSku: string | null = li.promoSku || null;
    if (promoSku && !validPromoSkus.has(promoSku)) {
      unknownPromoCount++;
      promoSku = null;
    }
    lineItemsOut.push([li.orderNo, li.lineNo, li.sku, li.productName, li.unit, li.qty, li.unitPrice, li.discount, li.lineTotal, promoSku]);
  }
  if (orphanLineCount > 0) addSkip(lineRep, 'order number not found in API Import or คำสั่งซื้อ VS (orphaned SKU Detail row)', orphanLineCount);
  if (unknownPromoCount > 0) addSkip(lineRep, 'Promo SKU column references a SKU not found in the โปรโมชั่น tab — promo_sku left NULL', unknownPromoCount);

  // ---- Transform: delivery_bookings ----
  const bookingsRep = newReport('delivery_bookings');
  const bookingsOut: unknown[][] = [];
  let bookingOrphanCount = 0;
  for (const b of bookings ?? []) {
    if (!validOrderUids.has(b.orderNo)) {
      bookingOrphanCount++;
      continue;
    }
    bookingsOut.push([b.orderNo, b.driverUsername, b.driverVehicleId, b.status, b.bookedAt || null, b.decidedBy, blankToNull(b.decidedAt), b.note]);
  }
  if (bookingOrphanCount > 0) addSkip(bookingsRep, 'order number not found in API Import or คำสั่งซื้อ VS (orphaned Bookings row)', bookingOrphanCount);
  if (bookings === null) bookingsRep.notes.push('"Bookings" tab not found in the spreadsheet — nothing to migrate.');

  // ---- Tables with NO server-reachable source: report honestly, touch nothing ----
  for (const [table, why] of [
    ['activity_log', 'src/data/activityLog.ts stores this in each browser\'s own localStorage only — it has never been sent to any backend or Sheet, so no server-side script (this one included) can read it. If this history matters, a future phase would need an in-app "export my activity log" action per user before it can be centralized.'],
    ['goods_receiving / goods_receiving_lines', 'src/data/receiving.ts is localStorage-only, same as activity_log — no backend endpoint has ever existed for it.'],
    ['batch_picking / batch_picking_orders / batch_picking_picks', 'src/data/pickLots.ts is localStorage-only, same as activity_log — no backend endpoint has ever existed for it.'],
    ['attachments', 'File uploads go to Drive via the backend, but the metadata index (src/data/sources/attachments.ts) is localStorage-only and was never written back to any Sheet — there is no server-reachable list of "which files were uploaded for which order" to migrate from.'],
  ] as const) {
    const r = newReport(table);
    r.notes.push(`SKIPPED — no server-reachable source exists. ${why}`);
  }

  // ---------------------------------------------------------------------------
  // Load — one transaction: TRUNCATE the 8 tables this script owns, then
  // insert everything freshly transformed above, in FK-safe order.
  // ---------------------------------------------------------------------------
  console.log('\nWriting to Postgres…');
  const sql = getDb();
  // postgres.js's bulk-insert helper (sql(rows)) types each cell as
  // `string | number` even though it serializes null/boolean/Date correctly
  // at runtime (verified locally before this script was written) — the cast
  // works around that overly-narrow TS signature, not around a real risk.
  const rows = (r: unknown[][]) => sql(r as (string | number)[][]);
  await sql.begin(async (tx) => {
    await tx`TRUNCATE TABLE order_line_items, delivery_bookings, orders, batch_routes, promotions, customers, sku_master, users RESTART IDENTITY CASCADE`;

    if (skuMasterOut.length) await tx`INSERT INTO sku_master (sku_id, barcode, name, unit, stock, status, location) VALUES ${rows(skuMasterOut)}`;
    if (promotionsOut.length) await tx`INSERT INTO promotions (id, sku, product_name, status, term_text, start_date, end_date, period_days, promotion_price, box_price, single_price) VALUES ${rows(promotionsOut)}`;
    if (customersOut.length) await tx`INSERT INTO customers (phone, name_from_unii, name_override, lat_from_unii, lng_from_unii, lat_override, lng_override, address_from_unii) VALUES ${rows(customersOut)}`;
    if (batchRoutesOut.length) await tx`INSERT INTO batch_routes (id, vehicle_id, vehicle_name, delivery_date, created_at, created_by, updated_at, updated_by, locked, cod_closed, cod_closed_at, cod_closed_by, cancelled, cancelled_at, cancelled_by) VALUES ${rows(batchRoutesOut)}`;
    if (usersOut.length) await tx`INSERT INTO users (username, password_hash, role, active, driver_vehicle_id, created_at) VALUES ${rows(usersOut)}`;
    if (ordersOut.length) await tx`INSERT INTO orders (order_uid, customer_phone, route, batch_route_id, delivery_date, note, needs_tax_invoice, promotion_id, delivery_issue, delivery_issue_note, assigned_driver, assigned_at, archived) VALUES ${rows(ordersOut)}`;
    if (lineItemsOut.length) await tx`INSERT INTO order_line_items (order_uid, line_no, sku, product_name, unit, qty, unit_price, discount, line_total, promo_sku) VALUES ${rows(lineItemsOut)}`;
    if (bookingsOut.length) await tx`INSERT INTO delivery_bookings (order_uid, driver_username, driver_vehicle_id, status, booked_at, decided_by, decided_at, note) VALUES ${rows(bookingsOut)}`;
  });

  // Fill in final migrated counts now that the transaction committed.
  report.find((r) => r.table === 'sku_master')!.migrated = skuMasterOut.length;
  report.find((r) => r.table === 'promotions')!.migrated = promotionsOut.length;
  report.find((r) => r.table === 'customers')!.migrated = customersOut.length;
  report.find((r) => r.table === 'batch_routes')!.migrated = batchRoutesOut.length;
  report.find((r) => r.table === 'users')!.migrated = usersOut.length;
  report.find((r) => r.table === 'orders')!.migrated = ordersOut.length;
  report.find((r) => r.table === 'order_line_items')!.migrated = lineItemsOut.length;
  report.find((r) => r.table === 'delivery_bookings')!.migrated = bookingsOut.length;

  return report;
}

export function printReport(rows: TableReport[]): void {
  console.log('\n' + '='.repeat(72));
  console.log('MIGRATION REPORT');
  console.log('='.repeat(72));
  for (const r of rows) {
    console.log(`\n${r.table}: ${r.migrated} row(s) migrated`);
    for (const s of r.skipped) console.log(`  - skipped ${s.count}: ${s.reason}`);
    for (const n of r.notes) console.log(`  * ${n}`);
  }
  console.log('\n' + '='.repeat(72));
  const totalMigrated = rows.reduce((sum, r) => sum + r.migrated, 0);
  const totalSkipped = rows.reduce((sum, r) => sum + r.skipped.reduce((a, s) => a + s.count, 0), 0);
  console.log(`TOTAL: ${totalMigrated} rows migrated, ${totalSkipped} rows skipped (with reasons above).`);
  console.log('Google Sheets is unchanged — this script never writes to it.');
}

async function main() {
  const sheets = await getSheetsClient();
  const rows = await runMigration(sheets);
  printReport(rows);
  await getDb().end();
}

// Only auto-run when executed directly (`npx tsx scripts/migrate-to-postgres.ts`)
// — importing this module (e.g. from a test harness that injects a fake
// Sheets client) must not trigger a real run against real credentials.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('\nMIGRATION FAILED (transaction rolled back, Postgres unchanged):', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
