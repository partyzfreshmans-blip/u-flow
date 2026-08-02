import { google } from 'googleapis';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { DRIVE_ROOT_FOLDER_ENV, driveFolderPath, isAllowedFile, type AttachmentScope } from '../src/config/drive.js';
import { GEOCODE_MIN_INTERVAL_MS, NOMINATIM_REVERSE_URL, NOMINATIM_USER_AGENT } from '../src/config/geocoding.js';
import { isRouteOrdersTabConfigured, MAIN_SHEET_ID, ROUTE_ORDERS_NOT_CONFIGURED_MESSAGE, SHEET_TABS, SKU_SHEET_ID, STAFF_ORDER_INFO_HEADERS, STAFF_READONLY_HEADERS } from '../src/config/sheets.js';
import type { RouteOrder } from '../src/data/types.js';
import { DELIVERY_DONE_STATUSES } from '../src/state/helpers.js';
import { createSessionToken, verifySessionToken } from './session.js';

// Shared core for the backend that needs Google credentials: the CS Master
// lat/lng write-back, order edit write-back, and Drive uploads. Framework
// entry points (Express in server/index.ts for local dev, Vercel serverless
// functions in api/ for production) both call these same handlers so the
// business logic — validation, row matching, what gets written where — lives
// in exactly one place.
//
// The Google Service Account private key lives ONLY here, in the
// GOOGLE_SERVICE_ACCOUNT_KEY env var — never in the browser bundle.

export const CS_MASTER_GID = Number(SHEET_TABS.csMaster.gid);
export const ROUTE_ORDERS_GID = Number(SHEET_TABS.routeOrders.gid);
export const PROMOTIONS_GID = Number(SHEET_TABS.promotions.gid);
export const SKU_DETAIL_GID = Number(SHEET_TABS.skuDetail.gid);
export const API_IMPORT_GID = Number(SHEET_TABS.apiImport.gid);
export const SKU_MASTER_GID = Number(SHEET_TABS.skuMaster.gid);

// Columns in the CS Master tab: A=ชื่อ B=เบอร์ C=ที่อยู่ D=ละ(lat) E=ลอง(lng)
const LAT_COLUMN = 'D';
const LNG_COLUMN = 'E';
const NAME_COLUMN_INDEX = 0;
const PHONE_COLUMN_INDEX = 1;

// Columns in "คำสั่งซื้อ VS" — see config/sheets.ts's STAFF_ORDER_INFO_HEADERS
// for the single source of truth on exact header text/order (the user sets
// these up by hand in the real sheet, which also has its own Apps
// Script/formulas keyed to these exact strings — never guess a header name
// here). Looked up by header text each request, never by position, so a
// future column reorder in the sheet doesn't silently write to the wrong
// cell. STAFF_READONLY_HEADERS (new customer, Phone) are ARRAYFORMULA-driven
// and must never appear as a write target — see assertWritableColumn below,
// which every write in this file is required to pass through.
const [
  STAFF_ORDER_UID_HEADER,
  STAFF_ROUTE_HEADER,
  STAFF_BATCH_ROUTE_HEADER,
  STAFF_DELIVERY_DATE_HEADER,
  STAFF_NOTE_HEADER,
  STAFF_TAX_INVOICE_HEADER,
  STAFF_PROMOTION_HEADER,
  STAFF_OPERATIONAL_STATUS_HEADER,
  STAFF_COURIER_HEADER,
  STAFF_ASSIGN_DATE_HEADER,
  ,
  ,
  STAFF_ARCHIVED_HEADER,
] = STAFF_ORDER_INFO_HEADERS;
const DELIVERED_STATUS_VALUE = 'ส่งสำเร็จ';
// Not a done state — deliberately excluded from DELIVERY_DONE_STATUSES on
// the frontend (see src/state/helpers.ts) so a failed stop keeps showing up
// in stuck-order/incomplete tracking until someone resolves it (redeliver,
// cancel, etc.), same as any other still-open order.
export const DELIVERY_FAILED_STATUS_VALUE = 'ส่งไม่สำเร็จ';
// This app's own operational-status vocabulary — a small allowlist so a
// caller passing an arbitrary `status` string (e.g. batch picking closing a
// lot) can't accidentally write a typo/garbage value into the column. Never
// includes API Import's own status text (รอยืนยันออเดอร์/กำลังดำเนินการ/etc.)
// since this app never writes to that column at all anymore.
const KNOWN_OPERATIONAL_STATUS_VALUES = ['กำลังจัดส่ง', DELIVERED_STATUS_VALUE, DELIVERY_FAILED_STATUS_VALUE];

// Columns in the "โปรโมชั่น" tab — same header-name lookup approach as the
// คำสั่งซื้อ tab above (never by fixed position).
const PROMO_SKU_HEADER = 'SKU';
const PROMO_STATUS_HEADER = 'Status';
const PROMO_PRODUCT_NAME_HEADER = 'Product Name';
const PROMO_TERM_HEADER = 'Promotion Term';
const PROMO_START_HEADER = 'เริ่มโปร';
const PROMO_END_HEADER = 'สินสุด';
const PROMO_PRICE_HEADER = 'Promotion Price';
const PROMO_BOX_PRICE_HEADER = 'Box Price';
const PROMO_SINGLE_PRICE_HEADER = 'Single Price';
const PROMO_PERIOD_HEADER = 'Period (วัน)';

// Columns in the "SKU Detail" tab, same header-name lookup approach.
const LINE_ITEM_ORDER_NO_HEADER = 'เลขคำสั่งซื้อ';
const LINE_ITEM_NO_HEADER = 'No.';
const LINE_ITEM_SKU_HEADER = 'SKU';
// No dedicated column exists yet — bootstrapped the same way ARCHIVED_HEADER
// is, as a brand-new column appended past the sheet's current last column.
const LINE_ITEM_PROMO_SKU_HEADER = 'Promo SKU';

export interface ApiResult {
  status: number;
  body: unknown;
}

/** Returned by the .xlsx export handlers instead of ApiResult — a binary
 * file body rather than a JSON one, so every route dispatcher (api/*.ts's
 * sendResult, server/index.ts) checks for this shape first and sends the
 * buffer directly instead of calling res.json(). */
export interface FileResult {
  status: number;
  filename: string;
  contentType: string;
  // exceljs's own index.d.ts declares `declare interface Buffer extends
  // ArrayBuffer {}` — a legacy compat shim that global-merges with (and
  // structurally conflicts with) @types/node's real Buffer. Every call site
  // that hands a workbook.xlsx.writeBuffer() result to this field casts
  // through `unknown` first to work around it (a known exceljs quirk, not a
  // bug in this project's own types).
  buffer: Buffer;
}

export function isFileResult(result: ApiResult | FileResult): result is FileResult {
  return 'buffer' in result;
}

function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Sheet dates read as M/D/YYYY (no leading zeros); write back the same way so
 * USER_ENTERED parses it as the same date type as the surrounding cells. */
function isoToSheetDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
  return `${Number(m[2])}/${Number(m[3])}/${Number(m[1])}`;
}

/** The "โปรโมชั่น" tab writes dates as zero-padded DD-MM-YYYY (e.g.
 * "21-07-2026") — a completely different convention from the M/D/YYYY the
 * คำสั่งซื้อ tab uses above, confirmed from real rows already in that sheet.
 * Never share isoToSheetDate between the two tabs. */
function isoToPromoSheetDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw new Error('รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
  const [, year, month, day] = m;
  return `${day}-${month}-${year}`;
}

/** Whole days between two YYYY-MM-DD ISO dates — matches the "Period (วัน)"
 * column, which real rows already keep as end-minus-start in days. */
function daysBetweenIso(startIso: string, endIso: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((new Date(`${endIso}T00:00:00Z`).getTime() - new Date(`${startIso}T00:00:00Z`).getTime()) / MS_PER_DAY);
}

/** Matches the sheet's own datetime text form, e.g. "7/24/2026 8:00:00". */
function nowSheetDateTime(): string {
  const d = new Date();
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

// ---------- Short-TTL cache for Sheets reads ----------
// The Sheets API has just enough per-minute quota that every open tab
// polling every ~45s from several staff at once can trip it. Each cache
// created here remembers exactly one thing (e.g. "all API Import orders" or
// "all Users rows") for CACHE_TTL_MS; a read within that window never hits
// the network at all. When a live read past that window throws, this falls
// back to the last successful read instead of failing the whole request —
// callers that want to surface that (API Import) get `stale: true` back;
// callers that don't care (Users, an internal implementation detail) can
// just ignore it and use `.data`.
const SHEET_CACHE_TTL_MS = 60_000;

interface SheetCacheResult<T> {
  data: T;
  stale: boolean;
  error: string | null;
}

function makeSheetCache<T>() {
  let entry: { data: T; fetchedAt: number } | null = null;
  let inflight: Promise<T> | null = null;

  async function read(loader: () => Promise<T>): Promise<SheetCacheResult<T>> {
    if (entry && Date.now() - entry.fetchedAt < SHEET_CACHE_TTL_MS) {
      return { data: entry.data, stale: false, error: null };
    }
    if (!inflight) inflight = loader();
    try {
      const data = await inflight;
      entry = { data, fetchedAt: Date.now() };
      return { data, stale: false, error: null };
    } catch (err: unknown) {
      if (entry) {
        const message = err instanceof Error ? err.message : 'โหลดข้อมูลไม่สำเร็จ';
        return { data: entry.data, stale: true, error: message };
      }
      throw err;
    } finally {
      inflight = null;
    }
  }

  /** Forces the next read() past this cache's TTL — used right after a write
   * so the writer's own next read (and everyone else's within the next
   * ~60s) sees the change immediately instead of a pre-write snapshot. */
  function invalidate(): void {
    entry = null;
  }

  return { read, invalidate };
}

function getServiceAccountCredentials(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw || raw.trim() === '') {
    throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_KEY');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY ไม่ใช่ JSON ที่ถูกต้อง');
  }
  const creds = parsed as { client_email?: string; private_key?: string };
  if (!creds.client_email || !creds.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY ต้องมี client_email และ private_key');
  }
  // Escaped newlines survive being pasted into a single-line env value.
  return { client_email: creds.client_email, private_key: creds.private_key.replace(/\\n/g, '\n') };
}

async function getAuth(scopes: string[]) {
  const { client_email, private_key } = getServiceAccountCredentials();
  const auth = new google.auth.JWT({ email: client_email, key: private_key, scopes });
  await auth.authorize();
  return auth;
}

async function getSheetsClient() {
  const auth = await getAuth(['https://www.googleapis.com/auth/spreadsheets']);
  return google.sheets({ version: 'v4', auth });
}

async function getDriveClient() {
  const auth = await getAuth(['https://www.googleapis.com/auth/drive']);
  return google.drive({ version: 'v3', auth });
}

type DriveClient = ReturnType<typeof google.drive>;

/**
 * Resolve (creating if needed) a chain of folders under `parentId`.
 * A Service Account has no My Drive quota of its own, so the root folder must
 * be one the user created and shared with the account as an Editor.
 */
async function ensureFolderPath(drive: DriveClient, parentId: string, segments: string[]): Promise<string> {
  let current = parentId;
  for (const name of segments) {
    const escaped = name.replace(/'/g, "\\'");
    const existing = await drive.files.list({
      q: `name='${escaped}' and '${current}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const found = existing.data.files?.[0]?.id;
    if (found) {
      current = found;
      continue;
    }
    const created = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [current] },
      fields: 'id',
      supportsAllDrives: true,
    });
    if (!created.data.id) throw new Error(`สร้างโฟลเดอร์ "${name}" ใน Drive ไม่สำเร็จ`);
    current = created.data.id;
  }
  return current;
}

/** gid identifies a tab stably; the Sheets values API needs its title.
 * Defaults to the main spreadsheet — SKU Master is the one tab that lives on
 * a different spreadsheet entirely (SKU_SHEET_ID), so it's the only caller
 * that ever passes spreadsheetId explicitly. */
async function resolveSheetTitle(sheets: ReturnType<typeof google.sheets>, gid: number, spreadsheetId: string = MAIN_SHEET_ID): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const match = meta.data.sheets?.find((s) => s.properties?.sheetId === gid);
  const title = match?.properties?.title;
  if (!title) throw new Error(`ไม่พบแท็บที่มี gid=${gid} ในสเปรดชีต`);
  return title;
}

/** Phone formats in the sheet are inconsistent ("66 823848337", "6 895559406",
 * "082-384-8337"), so compare the last 9 digits — the part that actually
 * identifies the subscriber — rather than requiring an exact string match. */
function phoneKey(v: string): string {
  return v.replace(/\D/g, '').slice(-9);
}

// ---------- Users / authentication ----------
//
// User accounts (username, hashed password, role) live in their own "Users"
// tab on the main spreadsheet, created on first use. Unlike every other tab
// this backend reads, it is NEVER exposed through a public CSV export URL —
// the frontend only ever reaches it through these authenticated handlers, so
// simply knowing the tab's gid can't leak a password hash the way it could
// for a CSV-exported tab. The one residual risk this doesn't close: anyone
// who already has direct "Viewer" access to the underlying Google Sheet
// file itself (via Google's own sharing, not this app) could open it and
// see the Users tab. That's a real trade-off of using a spreadsheet as the
// user store instead of a dedicated database — acceptable for this app's
// current scale, but worth knowing about.
const USERS_TAB_TITLE = 'Users';
const USERS_HEADER = ['username', 'password_hash', 'role', 'active', 'driver_vehicle_id', 'created_at'];
export const VALID_ROLES = ['administrator', 'manager', 'admin_staff', 'checker', 'picker', 'driver'] as const;
export type ValidRole = (typeof VALID_ROLES)[number];

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hashHex] = stored.split(':');
  if (!salt || !hashHex) return false;
  const computed = scryptSync(password, salt, 64);
  let storedHash: Buffer;
  try {
    storedHash = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  return computed.length === storedHash.length && timingSafeEqual(computed, storedHash);
}

interface UserRecord {
  rowIndex: number;
  username: string;
  passwordHash: string;
  role: string;
  active: boolean;
  driverVehicleId: string;
  createdAt: string;
}

type SheetsClient = Awaited<ReturnType<typeof getSheetsClient>>;

/** Creates the Users tab (with header row) and seeds one throwaway test
 * account per role the very first time anything touches it. Idempotent —
 * a no-op once the tab already exists. */
async function ensureUsersSheet(sheets: SheetsClient): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === USERS_TAB_TITLE);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: MAIN_SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: USERS_TAB_TITLE } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: MAIN_SHEET_ID,
    range: `${USERS_TAB_TITLE}!A1:F1`,
    valueInputOption: 'RAW',
    requestBody: { values: [USERS_HEADER] },
  });

  // One example account per role, so there's something to log in with
  // immediately after this ships. These are throwaway testing credentials —
  // rotate (or delete and recreate) them before relying on this for
  // anything beyond a first smoke test.
  const seeds: { username: string; password: string; role: ValidRole; driverVehicleId: string }[] = [
    { username: 'admin', password: 'Admin#2026', role: 'administrator', driverVehicleId: '' },
    { username: 'manager1', password: 'Manager#2026', role: 'manager', driverVehicleId: '' },
    { username: 'staff1', password: 'Staff#2026', role: 'admin_staff', driverVehicleId: '' },
    { username: 'checker1', password: 'Checker#2026', role: 'checker', driverVehicleId: '' },
    { username: 'picker1', password: 'Picker#2026', role: 'picker', driverVehicleId: '' },
    { username: 'driver1', password: 'Driver#2026', role: 'driver', driverVehicleId: 'veh-a' },
  ];
  const rows = seeds.map((s) => [s.username, hashPassword(s.password), s.role, 'TRUE', s.driverVehicleId, new Date().toISOString()]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: MAIN_SHEET_ID,
    range: `${USERS_TAB_TITLE}!A:F`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

async function readUsers(sheets: SheetsClient): Promise<UserRecord[]> {
  await ensureUsersSheet(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${USERS_TAB_TITLE}!A:F` });
  const rows = res.data.values ?? [];
  const out: UserRecord[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const username = String(r[0] ?? '').trim();
    if (!username) continue;
    out.push({
      rowIndex: i + 1,
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

// Same ~60s-TTL/graceful-degradation cache as API Import (see makeSheetCache
// above), so a burst of logins/page loads doesn't re-read the Users tab on
// every single request. Only handleLogin and handleListUsers read through
// it; handleCreateUser/handleUpdateUser always read the tab fresh (they need
// the exact current row to avoid a duplicate-username race or writing over
// stale data) and call usersCache.invalidate() right after a successful
// write so the very next cached read — anyone's, not just this request's —
// sees the change immediately instead of waiting out the rest of the TTL.
const usersCache = makeSheetCache<UserRecord[]>();

async function readUsersCached(sheets: SheetsClient): Promise<UserRecord[]> {
  const { data } = await usersCache.read(() => readUsers(sheets));
  return data;
}

export async function handleLogin(body: unknown): Promise<ApiResult> {
  const { username, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    return { status: 400, body: { error: 'ต้องระบุ username และ password' } };
  }
  try {
    const sheets = await getSheetsClient();
    const users = await readUsersCached(sheets);
    const user = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      return { status: 401, body: { error: 'username หรือ password ไม่ถูกต้อง' } };
    }
    const token = createSessionToken(user.username, user.role, user.driverVehicleId || null);
    return { status: 200, body: { token, username: user.username, role: user.role, driverVehicleId: user.driverVehicleId || null } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เข้าสู่ระบบไม่สำเร็จ';
    console.error('[auth/login]', message);
    return { status: 500, body: { error: message } };
  }
}

export function handleMe(token: string | null): ApiResult {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' } };
  return { status: 200, body: { username: payload.username, role: payload.role, driverVehicleId: payload.driverVehicleId } };
}

export async function handleListUsers(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (payload.role !== 'administrator' && payload.role !== 'manager') {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์เข้าถึงหน้านี้' } };
  }
  try {
    const sheets = await getSheetsClient();
    const users = await readUsersCached(sheets);
    return {
      status: 200,
      body: { users: users.map((u) => ({ username: u.username, role: u.role, active: u.active, driverVehicleId: u.driverVehicleId, createdAt: u.createdAt })) },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลดรายชื่อผู้ใช้ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

export async function handleCreateUser(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (payload.role !== 'administrator') return { status: 403, body: { error: 'เฉพาะ Administrator เท่านั้นที่สร้างผู้ใช้ได้' } };

  const { username, password, role, driverVehicleId } = (body ?? {}) as Record<string, unknown>;
  if (typeof username !== 'string' || !username.trim()) return { status: 400, body: { error: 'ต้องระบุ username' } };
  if (typeof password !== 'string' || password.length < 8) return { status: 400, body: { error: 'password ต้องมีอย่างน้อย 8 ตัวอักษร' } };
  if (typeof role !== 'string' || !(VALID_ROLES as readonly string[]).includes(role)) {
    return { status: 400, body: { error: `role ต้องเป็นหนึ่งใน ${VALID_ROLES.join(', ')}` } };
  }

  try {
    const sheets = await getSheetsClient();
    const users = await readUsers(sheets);
    if (users.some((u) => u.username.toLowerCase() === username.trim().toLowerCase())) {
      return { status: 409, body: { error: `username "${username}" มีอยู่แล้ว` } };
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${USERS_TAB_TITLE}!A:F`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[username.trim(), hashPassword(password), role, 'TRUE', typeof driverVehicleId === 'string' ? driverVehicleId : '', new Date().toISOString()]],
      },
    });
    usersCache.invalidate();
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'สร้างผู้ใช้ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

export async function handleUpdateUser(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (payload.role !== 'administrator') return { status: 403, body: { error: 'เฉพาะ Administrator เท่านั้นที่แก้ไขผู้ใช้ได้' } };

  const { username, role, active, driverVehicleId, newPassword } = (body ?? {}) as Record<string, unknown>;
  if (typeof username !== 'string' || !username.trim()) return { status: 400, body: { error: 'ต้องระบุ username' } };
  if (role !== undefined && !(VALID_ROLES as readonly string[]).includes(role as string)) {
    return { status: 400, body: { error: `role ต้องเป็นหนึ่งใน ${VALID_ROLES.join(', ')}` } };
  }
  if (newPassword !== undefined && (typeof newPassword !== 'string' || newPassword.length < 8)) {
    return { status: 400, body: { error: 'password ใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' } };
  }

  try {
    const sheets = await getSheetsClient();
    const users = await readUsers(sheets);
    const user = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!user) return { status: 404, body: { error: `ไม่พบผู้ใช้ "${username}"` } };

    const nextRole = typeof role === 'string' ? role : user.role;
    const nextActive = typeof active === 'boolean' ? active : user.active;
    const nextDriverVehicleId = typeof driverVehicleId === 'string' ? driverVehicleId : user.driverVehicleId;
    const nextPasswordHash = typeof newPassword === 'string' ? hashPassword(newPassword) : user.passwordHash;

    await sheets.spreadsheets.values.update({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${USERS_TAB_TITLE}!A${user.rowIndex}:F${user.rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[user.username, nextPasswordHash, nextRole, nextActive ? 'TRUE' : 'FALSE', nextDriverVehicleId, user.createdAt]] },
    });
    usersCache.invalidate();
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'แก้ไขผู้ใช้ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

// ---------- Driver stop bookings ("จองคิว") ----------
//
// A driver can't assign themselves into a batch route directly (that stays
// manager/admin-only, unchanged) — instead they "book" an unassigned order
// here as a request, which a manager/admin then confirms (adding it to that
// driver's vehicle plan, same as a normal Assign) or rejects. Lives in its
// own "Bookings" tab, same reasoning as the Users tab: needs to be visible
// to every driver and every manager/admin at once, which localStorage
// (what routePlan/batchRoutes use) can never provide across devices — this
// is the one piece of planner state that genuinely has to be server-side.
const BOOKINGS_TAB_TITLE = 'Bookings';
const BOOKINGS_HEADER = ['orderNo', 'driverUsername', 'driverVehicleId', 'status', 'bookedAt', 'decidedBy', 'decidedAt', 'note'];
type BookingStatus = 'pending' | 'confirmed' | 'rejected';

interface BookingRecord {
  rowIndex: number;
  orderNo: string;
  driverUsername: string;
  driverVehicleId: string;
  status: BookingStatus;
  bookedAt: string;
  decidedBy: string;
  decidedAt: string;
  note: string;
}

async function ensureBookingsSheet(sheets: SheetsClient): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === BOOKINGS_TAB_TITLE);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: MAIN_SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: BOOKINGS_TAB_TITLE } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: MAIN_SHEET_ID,
    range: `${BOOKINGS_TAB_TITLE}!A1:H1`,
    valueInputOption: 'RAW',
    requestBody: { values: [BOOKINGS_HEADER] },
  });
}

async function readBookings(sheets: SheetsClient): Promise<BookingRecord[]> {
  await ensureBookingsSheet(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${BOOKINGS_TAB_TITLE}!A:H` });
  const rows = res.data.values ?? [];
  const out: BookingRecord[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const orderNo = String(r[0] ?? '').trim();
    if (!orderNo) continue;
    const status = String(r[3] ?? '').trim();
    out.push({
      rowIndex: i + 1,
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

function bookingRowValues(b: BookingRecord): unknown[] {
  return [b.orderNo, b.driverUsername, b.driverVehicleId, b.status, b.bookedAt, b.decidedBy, b.decidedAt, b.note];
}

/** Any authenticated user can list bookings — drivers need to see what's
 * already taken before picking, managers/admins need to see the queue of
 * pending requests. Nothing here is more sensitive than what's already on
 * the (also authenticated-only) planner page. */
export async function handleListBookings(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const sheets = await getSheetsClient();
    const bookings = await readBookings(sheets);
    return {
      status: 200,
      body: {
        bookings: bookings.map((b) => ({
          orderNo: b.orderNo,
          driverUsername: b.driverUsername,
          driverVehicleId: b.driverVehicleId,
          status: b.status,
          bookedAt: b.bookedAt,
          decidedBy: b.decidedBy,
          decidedAt: b.decidedAt,
          note: b.note,
        })),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลดรายการจองคิวไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** Driver-only: request one or more unassigned orders. Two drivers racing
 * for the same order is resolved as first-write-wins, arbitrated by actual
 * row order in the sheet (Google Sheets serializes writes to one
 * spreadsheet, so whichever append the API processed first lands in the
 * lower row) — not by request arrival order at this function, which two
 * concurrent serverless invocations can't otherwise agree on. Whoever's row
 * isn't first for its orderNo gets demoted to 'rejected' immediately and
 * reported back as a conflict, rather than left as a second live booking. */
export async function handleCreateBookings(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (payload.role !== 'driver') return { status: 403, body: { error: 'เฉพาะ Driver เท่านั้นที่จองคิวจุดส่งได้' } };
  if (!payload.driverVehicleId) return { status: 400, body: { error: 'บัญชีนี้ยังไม่ได้ผูกกับรถคันใด ติดต่อผู้ดูแลระบบก่อนจองคิว' } };

  const { orderNos } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(orderNos) || orderNos.length === 0) {
    return { status: 400, body: { error: 'ต้องเลือกอย่างน้อย 1 ออเดอร์' } };
  }
  const wanted = Array.from(
    new Set(orderNos.filter((n): n is string => typeof n === 'string' && n.trim() !== '').map((n) => n.trim())),
  );
  if (wanted.length === 0) return { status: 400, body: { error: 'ไม่มีเลขคำสั่งซื้อที่ถูกต้อง' } };

  try {
    const sheets = await getSheetsClient();
    const existing = await readBookings(sheets);
    const activeOrderNos = new Set(existing.filter((b) => b.status === 'pending' || b.status === 'confirmed').map((b) => b.orderNo));
    const alreadyTaken = wanted.filter((n) => activeOrderNos.has(n));
    const toCreate = wanted.filter((n) => !activeOrderNos.has(n));

    if (toCreate.length === 0) {
      return { status: 200, body: { created: [], conflicts: alreadyTaken } };
    }

    const bookedAt = new Date().toISOString();
    await sheets.spreadsheets.values.append({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${BOOKINGS_TAB_TITLE}!A:H`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: toCreate.map((orderNo) => bookingRowValues({
          rowIndex: -1, orderNo, driverUsername: payload.username, driverVehicleId: payload.driverVehicleId!,
          status: 'pending', bookedAt, decidedBy: '', decidedAt: '', note: '',
        })),
      },
    });

    // Re-read and resolve: for each order just requested, whichever active
    // row now has the lowest row index actually won it.
    const after = await readBookings(sheets);
    const created: string[] = [];
    const conflicts: string[] = [...alreadyTaken];
    for (const orderNo of toCreate) {
      const rowsForOrder = after
        .filter((b) => b.orderNo === orderNo && (b.status === 'pending' || b.status === 'confirmed'))
        .sort((a, b) => a.rowIndex - b.rowIndex);
      const winner = rowsForOrder[0];
      const mine = after.find((b) => b.orderNo === orderNo && b.driverUsername === payload.username && b.status === 'pending' && b.bookedAt === bookedAt);
      if (mine && winner && winner.rowIndex === mine.rowIndex) {
        created.push(orderNo);
      } else if (mine) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: MAIN_SHEET_ID,
          range: `${BOOKINGS_TAB_TITLE}!A${mine.rowIndex}:H${mine.rowIndex}`,
          valueInputOption: 'RAW',
          requestBody: {
            values: [bookingRowValues({ ...mine, status: 'rejected', decidedBy: 'system', decidedAt: new Date().toISOString(), note: 'ชนกับคำขอจองอื่นที่มาถึงก่อน' })],
          },
        });
        conflicts.push(orderNo);
      }
    }
    return { status: 200, body: { created, conflicts } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'จองคิวไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** Manager/admin decision on a pending booking — same role set as the rest
 * of the planner's edit permissions (canEditPlan on the frontend). Confirm
 * only marks the booking; the client is what actually adds the order into
 * the driver's vehicle plan (routePlan lives in localStorage, not here) and
 * still requires the normal separate Assign step to lock it into a batch. */
export async function handleDecideBooking(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!['administrator', 'manager', 'admin_staff'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์ยืนยัน/ปฏิเสธคำขอจองคิว' } };
  }

  const { orderNo, decision, note } = (body ?? {}) as Record<string, unknown>;
  if (typeof orderNo !== 'string' || !orderNo.trim()) return { status: 400, body: { error: 'ต้องระบุเลขคำสั่งซื้อ' } };
  if (decision !== 'confirm' && decision !== 'reject') return { status: 400, body: { error: 'decision ต้องเป็น confirm หรือ reject' } };

  try {
    const sheets = await getSheetsClient();
    const bookings = await readBookings(sheets);
    const booking = bookings.find((b) => b.orderNo === orderNo.trim() && b.status === 'pending');
    if (!booking) return { status: 404, body: { error: 'ไม่พบคำขอจองที่รอดำเนินการสำหรับออเดอร์นี้ — อาจถูกตัดสินใจไปแล้ว' } };

    const next: BookingRecord = {
      ...booking,
      status: decision === 'confirm' ? 'confirmed' : 'rejected',
      decidedBy: payload.username,
      decidedAt: new Date().toISOString(),
      note: typeof note === 'string' ? note.trim() : '',
    };
    await sheets.spreadsheets.values.update({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${BOOKINGS_TAB_TITLE}!A${booking.rowIndex}:H${booking.rowIndex}`,
      valueInputOption: 'RAW',
      requestBody: { values: [bookingRowValues(next)] },
    });
    return { status: 200, body: { ok: true, driverUsername: booking.driverUsername, driverVehicleId: booking.driverVehicleId } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'ยืนยัน/ปฏิเสธคำขอจองคิวไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

// ---------- Batch Routes ----------
// A "Batch Route" is a vehicle's locked delivery run for one day, created by
// the Planner's "Assign" step. Originally local-only (localStorage), but a
// driver logging in from their own phone — a different browser than
// whichever admin planned the route — would never see it: same reasoning as
// Bookings above, this now gets a real Sheet tab too so date-selection on
// Driver View works across devices, not just same-browser.
const BATCH_ROUTES_TAB_TITLE = 'Batch Routes';
const BATCH_ROUTES_HEADER = [
  'id', 'vehicleId', 'vehicleName', 'deliveryDate', 'orderNos', 'createdAt', 'createdBy',
  'updatedAt', 'updatedBy', 'locked', 'codClosed', 'codClosedAt', 'codClosedBy',
  'cancelled', 'cancelledAt', 'cancelledBy',
];

interface BatchRouteRecord {
  rowIndex: number;
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

async function ensureBatchRoutesSheet(sheets: SheetsClient): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === BATCH_ROUTES_TAB_TITLE);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: MAIN_SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: BATCH_ROUTES_TAB_TITLE } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${BATCH_ROUTES_TAB_TITLE}!A1:P1`,
      valueInputOption: 'RAW',
      requestBody: { values: [BATCH_ROUTES_HEADER] },
    });
    return;
  }

  // A sheet created before the cancelled/cancelledAt/cancelledBy columns
  // existed keeps its old, shorter header row — back it up to the full
  // header (additive only, row 1 only) so those columns actually get
  // labeled instead of silently reading as blank forever.
  const headerRes = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${BATCH_ROUTES_TAB_TITLE}!A1:P1` });
  const currentHeader = headerRes.data.values?.[0] ?? [];
  if (currentHeader.length < BATCH_ROUTES_HEADER.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${BATCH_ROUTES_TAB_TITLE}!A1:P1`,
      valueInputOption: 'RAW',
      requestBody: { values: [BATCH_ROUTES_HEADER] },
    });
  }
}

// orderNos is the one array-valued field — order numbers observed in this
// sheet are plain alphanumeric-with-hyphens, so "|" is a safe, human-readable
// join that will never collide with a real value.
async function readBatchRoutes(sheets: SheetsClient): Promise<BatchRouteRecord[]> {
  await ensureBatchRoutesSheet(sheets);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${BATCH_ROUTES_TAB_TITLE}!A:P` });
  const rows = res.data.values ?? [];
  const out: BatchRouteRecord[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const id = String(r[0] ?? '').trim();
    if (!id) continue;
    out.push({
      rowIndex: i + 1,
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

function batchRouteRowValues(b: Omit<BatchRouteRecord, 'rowIndex'>): unknown[] {
  return [
    b.id, b.vehicleId, b.vehicleName, b.deliveryDate, b.orderNos.join('|'), b.createdAt, b.createdBy,
    b.updatedAt, b.updatedBy, b.locked ? 'TRUE' : 'FALSE', b.codClosed ? 'TRUE' : 'FALSE', b.codClosedAt, b.codClosedBy,
    b.cancelled ? 'TRUE' : 'FALSE', b.cancelledAt, b.cancelledBy,
  ];
}

/** Any authenticated user can list batch routes — same reasoning as
 * Bookings: a driver needs to see their own vehicle's assigned dates, and
 * nothing here is more sensitive than what the desktop Planner already
 * shows to manager/admin_staff. */
export async function handleListBatchRoutes(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const sheets = await getSheetsClient();
    const records = await readBatchRoutes(sheets);
    return {
      status: 200,
      body: {
        batchRoutes: records.map(({ rowIndex: _rowIndex, ...b }) => b),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลด Batch Route ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** Bulk upsert — the client always sends its whole current batchRoutes list
 * (never large: a handful of vehicles × at most a couple of batches each per
 * day), matched back to sheet rows by id; unmatched ids are appended.
 *
 * administrator/manager/admin_staff may write any field (this mirrors the
 * exact same set of roles the Planner's own batch-editing actions already
 * require client-side). A driver may also call this — but ONLY to close out
 * COD on their own vehicle's batch, exactly the "ปิดยอดรอบนี้ (batch)"
 * button on their own Driver View COD tab already lets them do — so every
 * driver-submitted record is checked field-by-field against what's already
 * stored: vehicleId/orderNos/locked/etc. must be byte-for-byte unchanged,
 * only codClosed/codClosedAt/codClosedBy (and updatedAt/updatedBy) may
 * differ, and vehicleId must match the driver's own session. This is
 * deliberately stricter than trusting the client, since this endpoint is the
 * one place a compromised or buggy driver session could otherwise rewrite
 * someone else's route. */
export async function handleUpsertBatchRoutes(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!['administrator', 'manager', 'admin_staff', 'driver'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์แก้ไข Batch Route' } };
  }

  const { batchRoutes } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(batchRoutes)) return { status: 400, body: { error: 'ต้องระบุ batchRoutes เป็น array' } };

  const incoming: Omit<BatchRouteRecord, 'rowIndex'>[] = [];
  for (const raw of batchRoutes) {
    const b = (raw ?? {}) as Record<string, unknown>;
    if (typeof b.id !== 'string' || !b.id.trim()) return { status: 400, body: { error: 'batchRoutes ทุกรายการต้องมี id' } };
    incoming.push({
      id: b.id.trim(),
      vehicleId: typeof b.vehicleId === 'string' ? b.vehicleId : '',
      vehicleName: typeof b.vehicleName === 'string' ? b.vehicleName : '',
      deliveryDate: typeof b.deliveryDate === 'string' ? b.deliveryDate : '',
      orderNos: Array.isArray(b.orderNos) ? b.orderNos.filter((n): n is string => typeof n === 'string') : [],
      createdAt: typeof b.createdAt === 'string' ? b.createdAt : '',
      createdBy: typeof b.createdBy === 'string' ? b.createdBy : '',
      updatedAt: typeof b.updatedAt === 'string' ? b.updatedAt : new Date().toISOString(),
      updatedBy: typeof b.updatedBy === 'string' ? b.updatedBy : payload.username,
      locked: b.locked === true,
      codClosed: b.codClosed === true,
      codClosedAt: typeof b.codClosedAt === 'string' ? b.codClosedAt : '',
      codClosedBy: typeof b.codClosedBy === 'string' ? b.codClosedBy : '',
      cancelled: b.cancelled === true,
      cancelledAt: typeof b.cancelledAt === 'string' ? b.cancelledAt : '',
      cancelledBy: typeof b.cancelledBy === 'string' ? b.cancelledBy : '',
    });
  }

  try {
    const sheets = await getSheetsClient();
    const existing = await readBatchRoutes(sheets);
    const existingById = new Map(existing.map((b) => [b.id, b]));

    if (payload.role === 'driver') {
      for (const b of incoming) {
        const cur = existingById.get(b.id);
        if (!cur) return { status: 403, body: { error: 'Driver ไม่มีสิทธิ์สร้าง Batch Route ใหม่' } };
        if (cur.vehicleId !== payload.driverVehicleId) {
          return { status: 403, body: { error: 'Driver แก้ไขได้เฉพาะ Batch Route ของรถตัวเอง' } };
        }
        // "ยกเลิก Batch Route" is an administrator/manager/admin_staff-only
        // action (see canCancelBatchRoute) — explicitly excluded from what a
        // driver's own COD-close request is allowed to touch, same as every
        // other non-COD field checked below.
        const onlyCodFieldsChanged =
          cur.vehicleId === b.vehicleId &&
          cur.vehicleName === b.vehicleName &&
          cur.deliveryDate === b.deliveryDate &&
          cur.orderNos.join('|') === b.orderNos.join('|') &&
          cur.locked === b.locked &&
          cur.createdAt === b.createdAt &&
          cur.createdBy === b.createdBy &&
          cur.cancelled === b.cancelled &&
          cur.cancelledAt === b.cancelledAt &&
          cur.cancelledBy === b.cancelledBy;
        if (!onlyCodFieldsChanged) {
          return { status: 403, body: { error: 'Driver แก้ไขได้เฉพาะสถานะปิดยอด COD เท่านั้น' } };
        }
      }
    }

    const updates: { range: string; values: unknown[][] }[] = [];
    const appends: unknown[][] = [];
    for (const b of incoming) {
      const cur = existingById.get(b.id);
      if (cur) {
        updates.push({ range: `${BATCH_ROUTES_TAB_TITLE}!A${cur.rowIndex}:P${cur.rowIndex}`, values: [batchRouteRowValues(b)] });
      } else {
        appends.push(batchRouteRowValues(b));
      }
    }
    for (const u of updates) {
      await sheets.spreadsheets.values.update({ spreadsheetId: MAIN_SHEET_ID, range: u.range, valueInputOption: 'RAW', requestBody: { values: u.values } });
    }
    if (appends.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${BATCH_ROUTES_TAB_TITLE}!A:P`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: appends },
      });
    }

    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'บันทึก Batch Route ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** "Export เป็น Excel" on Batch Route History — one summary row per batch
 * plus a second sheet with one row per order-within-a-batch (the "stops"
 * BatchRouteHistoryPanel expands to show), joined against the same API
 * Import + คำสั่งซื้อ VS data as handleExportRouteOrders. COD cash figures
 * (expected/collected/diff/transfer) are deliberately left out — that state
 * only ever lived in the browser's local COD-clearing store, never in a
 * sheet, so there's nothing server-side to export for it. */
export async function handleExportBatchRouteHistory(token: string | null): Promise<ApiResult | FileResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };

  try {
    const sheets = await getSheetsClient();
    const [{ data: apiOrders }, staffInfos, batches] = await Promise.all([
      apiImportOrdersCache.read(loadApiImportOrders),
      readStaffOrderInfoSheet(sheets),
      readBatchRoutes(sheets),
    ]);
    const orderByNo = new Map(joinRouteOrdersForExport(apiOrders, staffInfos).map((o): [string, RouteOrder] => [o.orderNo, o]));

    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();

    const summarySheet = workbook.addWorksheet('Batch Routes');
    summarySheet.columns = [
      { header: 'Batch ID', key: 'id', width: 16 },
      { header: 'รถ', key: 'vehicleName', width: 16 },
      { header: 'วันที่จัดส่ง', key: 'deliveryDate', width: 14 },
      { header: 'จำนวนออเดอร์', key: 'orderCount', width: 12 },
      { header: 'ยอดรวม', key: 'totalAmount', width: 14 },
      { header: 'ส่งสำเร็จแล้ว', key: 'deliveredCount', width: 12 },
      { header: 'สถานะ', key: 'statusText', width: 16 },
      { header: 'สร้างโดย', key: 'createdBy', width: 14 },
      { header: 'สร้างเมื่อ', key: 'createdAt', width: 22 },
      { header: 'แก้ไขล่าสุดโดย', key: 'updatedBy', width: 14 },
      { header: 'แก้ไขล่าสุดเมื่อ', key: 'updatedAt', width: 22 },
      { header: 'ยกเลิกโดย', key: 'cancelledBy', width: 14 },
      { header: 'ยกเลิกเมื่อ', key: 'cancelledAt', width: 22 },
      { header: 'ปิด COD โดย', key: 'codClosedBy', width: 14 },
      { header: 'ปิด COD เมื่อ', key: 'codClosedAt', width: 22 },
    ];
    summarySheet.getRow(1).font = { bold: true };

    const stopsSheet = workbook.addWorksheet('ออเดอร์ในแต่ละ Batch');
    stopsSheet.columns = [
      { header: 'Batch ID', key: 'batchId', width: 16 },
      { header: 'รถ', key: 'vehicleName', width: 16 },
      { header: 'เลขคำสั่งซื้อ', key: 'orderNo', width: 16 },
      { header: 'ลูกค้า', key: 'customer', width: 24 },
      { header: 'ยอดขาย', key: 'totalAmount', width: 12 },
      { header: 'สถานะ', key: 'status', width: 18 },
    ];
    stopsSheet.getRow(1).font = { bold: true };

    for (const b of batches) {
      const stops = b.orderNos.map((no) => orderByNo.get(no)).filter((o): o is RouteOrder => o != null);
      const totalAmount = stops.reduce((sum, o) => sum + o.totalAmount, 0);
      const deliveredCount = stops.filter((o) => DELIVERY_DONE_STATUSES.includes(o.status)).length;
      const statusText = b.cancelled ? 'ยกเลิกแล้ว' : b.codClosed ? 'ปิด COD แล้ว' : b.locked ? 'ล็อกแล้ว' : 'ใช้งานอยู่';

      summarySheet.addRow({
        id: b.id,
        vehicleName: b.vehicleName,
        deliveryDate: b.deliveryDate,
        orderCount: b.orderNos.length,
        totalAmount,
        deliveredCount,
        statusText,
        createdBy: b.createdBy,
        createdAt: b.createdAt,
        updatedBy: b.updatedBy,
        updatedAt: b.updatedAt,
        cancelledBy: b.cancelled ? b.cancelledBy : '',
        cancelledAt: b.cancelled ? b.cancelledAt : '',
        codClosedBy: b.codClosed ? b.codClosedBy : '',
        codClosedAt: b.codClosed ? b.codClosedAt : '',
      });

      for (const no of b.orderNos) {
        const o = orderByNo.get(no);
        stopsSheet.addRow({
          batchId: b.id,
          vehicleName: b.vehicleName,
          orderNo: no,
          customer: o?.customer ?? '',
          totalAmount: o?.totalAmount ?? '',
          status: o?.status ?? '',
        });
      }
    }

    // exceljs's own type declarations shadow the global Buffer interface
    // with a narrower one (see FileResult's comment) — cast through unknown
    // to sidestep that structural mismatch rather than the two never unifying.
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return {
      status: 200,
      filename: `batch-route-history-${new Date().toISOString().slice(0, 10)}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'สร้างไฟล์ Excel ไม่สำเร็จ';
    console.error('[batch-routes/export]', message);
    return { status: 500, body: { error: message } };
  }
}

export function handleHealth(): ApiResult {
  const configured = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  return {
    status: 200,
    body: {
      ok: true,
      serviceAccountConfigured: configured,
      driveFolderConfigured: !!process.env[DRIVE_ROOT_FOLDER_ENV]?.trim(),
      driveMockMode: !configured || !process.env[DRIVE_ROOT_FOLDER_ENV]?.trim(),
    },
  };
}

export async function handleUpdateCsMasterLocation(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  // This endpoint only ever writes lat/lng, never any other customer field —
  // which is exactly the narrower permission a driver has here, so allowing
  // them through this specific endpoint is itself the field-level restriction.
  if (!['administrator', 'manager', 'admin_staff', 'driver'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์แก้ไขพิกัดลูกค้า' } };
  }

  const { name, phone, lat, lng } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim() === '') {
    return { status: 400, body: { error: 'ต้องระบุชื่อลูกค้า' } };
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { status: 400, body: { error: 'lat/lng ต้องเป็นตัวเลข' } };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { status: 400, body: { error: 'lat/lng อยู่นอกช่วงที่เป็นไปได้' } };
  }

  try {
    const sheets = await getSheetsClient();
    const title = await resolveSheetTitle(sheets, CS_MASTER_GID);

    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${title}!A:E`,
    });
    const rows = current.data.values ?? [];

    // Row 1 is the header. Match by phone whenever one was given — the
    // customer's real, stable identity (a shop can rename itself; its phone
    // number is what actually stays constant) — falling back to name only
    // when there's no phone to key off of at all. Matching on name+phone
    // together, as this used to, silently broke the moment a customer's
    // name in CS Master and whatever name the caller last saw drifted apart
    // (a rename in between), since that pairing then matched nothing.
    const wantedName = name.trim();
    const wantedPhone = typeof phone === 'string' ? phoneKey(phone) : '';
    const matches: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const rowName = String(rows[i]?.[NAME_COLUMN_INDEX] ?? '').trim();
      const rowPhone = phoneKey(String(rows[i]?.[PHONE_COLUMN_INDEX] ?? ''));
      const isMatch = wantedPhone !== '' ? rowPhone === wantedPhone : rowName === wantedName;
      if (isMatch) matches.push(i + 1); // sheet rows are 1-based
    }

    if (matches.length === 0) {
      return { status: 404, body: { error: `ไม่พบลูกค้า "${wantedName}" ในชีท CS Master` } };
    }
    // Refuse to guess when the identifiers are ambiguous — writing to the
    // wrong customer's row is worse than making someone disambiguate.
    if (matches.length > 1) {
      return { status: 409, body: { error: `พบลูกค้า "${wantedName}" ซ้ำกัน ${matches.length} แถว (แถว ${matches.join(', ')}) — โปรดแก้ไขในชีทโดยตรง` } };
    }
    const targetRow = matches[0];

    await sheets.spreadsheets.values.update({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${title}!${LAT_COLUMN}${targetRow}:${LNG_COLUMN}${targetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[lat, lng]] },
    });

    return { status: 200, body: { ok: true, updatedRow: targetRow } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[cs-master/update-location]', message);
    return { status: 500, body: { error: message } };
  }
}

// ---------- API Import orders (read-only) ----------
// The one raw source of truth for order data — read live from the "API
// Import" tab (resolved by gid, same as every other tab here, so a rename in
// the sheet never breaks this) straight through the Sheets API with the
// Service Account, never the old public CSV export URL: this way reading and
// writing (see handleUpdateRouteOrder below) go through the exact same
// authenticated path, and the tab doesn't have to stay publicly link-shared.
function apiImportToNumber(v: unknown): number {
  const cleaned = String(v ?? '').replace(/,/g, '').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function apiImportToLatLng(v: unknown): number | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Same column-by-header-text mapping this tab has always used (see the
 * pre-Unii src/data/sources/apiImportOrders.ts), just fed from Sheets API
 * rows (array-of-arrays) instead of parsed CSV text. */
function rowsToApiImportOrders(rows: unknown[][]): ApiImportOrderShape[] {
  if (rows.length === 0) return [];
  const header = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const out: ApiImportOrderShape[] = [];
  for (let i = 1; i < rows.length; i++) {
    const raw: Record<string, unknown> = {};
    header.forEach((h, idx) => {
      if (h) raw[h] = rows[i]?.[idx] ?? '';
    });
    const get = (key: string) => String(raw[key] ?? '').trim();
    const orderUid = get('Order UID');
    if (!orderUid) continue;
    out.push({
      no: get('No.'),
      orderUid,
      status: get('สถานะ'),
      paymentType: get('ประเภทชำระเงิน'),
      paid: get('ชำระเงินแล้ว'),
      itemCount: apiImportToNumber(raw['จำนวนรายการ']),
      totalAmount: apiImportToNumber(raw['ยอดขายรวม']),
      customer: get('ลูกค้า'),
      phone: get('เบอร์โทร'),
      address: get('ที่อยู่'),
      district: get('อำเภอ'),
      province: get('จังหวัด'),
      orderedAt: get('วันที่สั่ง'),
      deliveredAt: get('วันที่จัดส่ง'),
      completedAt: get('วันที่ส่งสำเร็จ'),
      wantsTaxInvoice: get('ขอใบกำกับภาษี'),
      updatedAt: get('วันที่อัปเดต'),
      lat: apiImportToLatLng(raw['Latitude']),
      lng: apiImportToLatLng(raw['Longitude']),
      distanceFromWhKm: apiImportToLatLng(raw['far_from_wh']),
      whLat: apiImportToLatLng(raw['wh_lat']),
      whLng: apiImportToLatLng(raw['wh_long']),
      raw,
    });
  }
  return out;
}

/** Matches src/data/types.ts's ApiImportOrder shape — duplicated here rather
 * than imported so server/lib.ts (used by both the Vercel functions and the
 * local Express server) never has to reach into src/data at the type-only
 * level for anything but the tiny already-shared config in src/config. */
interface ApiImportOrderShape {
  no: string;
  orderUid: string;
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
  distanceFromWhKm: number | null;
  whLat: number | null;
  whLng: number | null;
  raw: Record<string, unknown>;
}

const apiImportOrdersCache = makeSheetCache<ApiImportOrderShape[]>();

async function loadApiImportOrders(): Promise<ApiImportOrderShape[]> {
  const sheets = await getSheetsClient();
  const title = await resolveSheetTitle(sheets, API_IMPORT_GID);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
  return rowsToApiImportOrders(res.data.values ?? []);
}

export async function handleFetchApiImportOrders(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const { data, stale, error } = await apiImportOrdersCache.read(loadApiImportOrders);
    return { status: 200, body: { orders: data, stale, error } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลดออเดอร์จาก API Import ไม่สำเร็จ';
    console.error('[route-orders/api-import]', message);
    return { status: 500, body: { error: message } };
  }
}

interface StaffOrderInfoShape {
  orderUid: string;
  plannedDeliveryDate: string;
  note: string;
  taxInvoiceOverride: boolean | null;
  operationalStatus: string;
  courierStamp: string;
  promotionFlag: boolean;
  archived: boolean;
  newCustomer: string;
}

function parseTriStateBool(v: string): boolean | null {
  const s = v.trim();
  if (!s) return null;
  return /^(ใช่|yes|true|y)$/i.test(s);
}

function parseYesNo(v: string): boolean {
  return /^(ใช่|yes|true|y)$/i.test(v.trim());
}

/** Same header-text mapping src/data/sources/staffOrderInfo.ts uses for its
 * (client-side) read of "คำสั่งซื้อ VS" — re-implemented here, fed from
 * Sheets API rows instead, purely for the .xlsx export handlers below
 * (every other read of this tab happens client-side, never here). Read-only
 * — never writes — so it doesn't need the read-only-column guard the write
 * path (handleUpdateRouteOrder) has. */
async function readStaffOrderInfoSheet(sheets: SheetsClient): Promise<StaffOrderInfoShape[]> {
  if (!isRouteOrdersTabConfigured()) return [];
  const title = await resolveSheetTitle(sheets, ROUTE_ORDERS_GID);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
  const rows = res.data.values ?? [];
  if (rows.length === 0) return [];
  const header = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const at = (name: string) => header.indexOf(name);
  const uidCol = at(STAFF_ORDER_UID_HEADER);
  const routeCol = at(STAFF_ROUTE_HEADER);
  const batchRouteCol = at(STAFF_BATCH_ROUTE_HEADER);
  const dateCol = at(STAFF_DELIVERY_DATE_HEADER);
  const noteCol = at(STAFF_NOTE_HEADER);
  const taxCol = at(STAFF_TAX_INVOICE_HEADER);
  const statusCol = at(STAFF_OPERATIONAL_STATUS_HEADER);
  const courierCol = at(STAFF_COURIER_HEADER);
  const promotionCol = at(STAFF_PROMOTION_HEADER);
  const archivedCol = at(STAFF_ARCHIVED_HEADER);
  const newCustomerCol = at('new customer');
  const out: StaffOrderInfoShape[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const orderUid = String(r[uidCol] ?? '').trim();
    if (!orderUid) continue;
    const route = String(r[routeCol] ?? '').trim();
    const batchRoute = String(r[batchRouteCol] ?? '').trim();
    const courier = String(r[courierCol] ?? '').trim();
    out.push({
      orderUid,
      plannedDeliveryDate: String(r[dateCol] ?? '').trim(),
      note: String(r[noteCol] ?? '').trim(),
      taxInvoiceOverride: parseTriStateBool(String(r[taxCol] ?? '')),
      operationalStatus: String(r[statusCol] ?? '').trim(),
      courierStamp: [route, batchRoute, courier].filter(Boolean).join('/'),
      promotionFlag: parseYesNo(String(r[promotionCol] ?? '')),
      archived: parseYesNo(String(r[archivedCol] ?? '')),
      newCustomer: String(r[newCustomerCol] ?? '').trim(),
    });
  }
  return out;
}

/** Same join src/data/sources/routeOrders.ts's joinRouteOrders performs on
 * the frontend — re-implemented here (not imported) since that module's own
 * imports pull in the DOM fetch/Response types this file's Node-only
 * tsconfig doesn't carry, and mixing them breaks exceljs's Buffer-returning
 * APIs used just below. If joinRouteOrders' behavior ever changes, this
 * needs the same change made twice. */
function joinRouteOrdersForExport(apiOrders: ApiImportOrderShape[], staffInfos: StaffOrderInfoShape[]): RouteOrder[] {
  const staffByUid = new Map(staffInfos.map((s) => [s.orderUid, s]));
  return apiOrders.map((o): RouteOrder => {
    const staff = staffByUid.get(o.orderUid);
    const districtProvince = [o.district, o.province].filter(Boolean).join(', ');
    const mapLink = o.lat != null && o.lng != null ? `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}` : '';
    return {
      orderedAtText: o.orderedAt,
      customer: o.customer,
      orderNo: o.orderUid,
      itemCount: o.itemCount,
      totalAmount: o.totalAmount,
      paymentType: o.paymentType,
      status: staff?.operationalStatus || o.status,
      plannedDeliveryDate: staff?.plannedDeliveryDate ?? '',
      note: staff?.note ?? '',
      isNewCustomer: staff?.newCustomer ?? '',
      orderedDate: o.orderedAt,
      deliveredDate: o.deliveredAt,
      completedDate: o.completedAt,
      updatedDate: o.updatedAt,
      wantsTaxInvoice: staff?.taxInvoiceOverride ?? parseYesNo(o.wantsTaxInvoice),
      archived: staff?.archived ?? false,
      districtProvince,
      addressFromUnii: o.address,
      mapLink,
      lat: o.lat,
      lng: o.lng,
      phone: o.phone,
      distanceFromWhKm: o.distanceFromWhKm,
      whLat: o.whLat,
      whLng: o.whLng,
      courierStamp: staff?.courierStamp ?? '',
      promotionFlag: staff?.promotionFlag ?? false,
    };
  });
}

// ---------- Sheet-tab list reads (CS Master, Promotions, SKU Detail,
// Staff Order Info "คำสั่งซื้อ VS", SKU Master) ----------
// These five tabs used to be read straight from the browser via Sheets'
// public CSV export URL (no auth needed) — cheap and simple, but it only
// works while every tab stays link-shared "Anyone with the link can view".
// Once the spreadsheet is set to Restricted, that URL redirects to a Google
// login page instead of CSV, which the browser then can't read cross-origin
// (a CORS failure, surfacing as a plain "Failed to fetch" with no useful
// detail). Reading them through this authenticated Service Account path —
// same one every write-back handler already uses — works regardless of the
// spreadsheet's sharing settings.
//
// Each handler returns rows in exactly the shape Papaparse's
// `{ header: true }` mode used to produce (an array of header-keyed
// objects, every value a string) so the frontend's existing per-tab
// row-mapping functions (rowToCustomer, rowToPromo, rowToLineItem, ...)
// needed zero changes — only their data source swapped.
function sheetRowsToRecords(rows: unknown[][]): Record<string, string>[] {
  if (rows.length === 0) return [];
  const header = (rows[0] ?? []).map((h) => String(h ?? '').trim());
  const out: Record<string, string>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const record: Record<string, string> = {};
    header.forEach((h, idx) => {
      if (h) record[h] = String(rows[i]?.[idx] ?? '');
    });
    out.push(record);
  }
  return out;
}

const csMasterRowsCache = makeSheetCache<Record<string, string>[]>();
const promotionsRowsCache = makeSheetCache<Record<string, string>[]>();
const skuDetailRowsCache = makeSheetCache<Record<string, string>[]>();
const staffOrderInfoRowsCache = makeSheetCache<Record<string, string>[]>();
const skuMasterRowsCache = makeSheetCache<Record<string, string>[]>();

/** Shared by every handler below — verifies the session, runs `read`
 * through its cache, and shapes the {rows, stale, error} response. Every
 * one of these tabs is readable by any authenticated user, same as
 * Bookings/Batch Routes: nothing here is more sensitive than what the page
 * that reads it already shows everyone who can reach it. */
async function handleSheetRowsList(
  token: string | null,
  cache: ReturnType<typeof makeSheetCache<Record<string, string>[]>>,
  read: () => Promise<Record<string, string>[]>,
  failureMessage: string,
): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const { data, stale, error } = await cache.read(read);
    return { status: 200, body: { rows: data, stale, error } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : failureMessage;
    console.error('[sheets/list]', message);
    return { status: 500, body: { error: message } };
  }
}

export async function handleFetchCsMasterList(token: string | null): Promise<ApiResult> {
  return handleSheetRowsList(
    token,
    csMasterRowsCache,
    async () => {
      const sheets = await getSheetsClient();
      const title = await resolveSheetTitle(sheets, CS_MASTER_GID);
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
      return sheetRowsToRecords(res.data.values ?? []);
    },
    'โหลดรายชื่อลูกค้า (CS Master) ไม่สำเร็จ',
  );
}

export async function handleFetchPromotionsList(token: string | null): Promise<ApiResult> {
  return handleSheetRowsList(
    token,
    promotionsRowsCache,
    async () => {
      const sheets = await getSheetsClient();
      const title = await resolveSheetTitle(sheets, PROMOTIONS_GID);
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
      return sheetRowsToRecords(res.data.values ?? []);
    },
    'โหลดโปรโมชั่นไม่สำเร็จ',
  );
}

export async function handleFetchSkuDetailList(token: string | null): Promise<ApiResult> {
  return handleSheetRowsList(
    token,
    skuDetailRowsCache,
    async () => {
      const sheets = await getSheetsClient();
      const title = await resolveSheetTitle(sheets, SKU_DETAIL_GID);
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
      return sheetRowsToRecords(res.data.values ?? []);
    },
    'โหลดรายการสินค้าต่อออเดอร์ (SKU Detail) ไม่สำเร็จ',
  );
}

export async function handleFetchStaffOrderInfoList(token: string | null): Promise<ApiResult> {
  if (!isRouteOrdersTabConfigured()) return { status: 500, body: { error: ROUTE_ORDERS_NOT_CONFIGURED_MESSAGE } };
  return handleSheetRowsList(
    token,
    staffOrderInfoRowsCache,
    async () => {
      const sheets = await getSheetsClient();
      const title = await resolveSheetTitle(sheets, ROUTE_ORDERS_GID);
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
      return sheetRowsToRecords(res.data.values ?? []);
    },
    'โหลดข้อมูลออเดอร์ (คำสั่งซื้อ VS) ไม่สำเร็จ',
  );
}

export async function handleFetchSkuMasterList(token: string | null): Promise<ApiResult> {
  return handleSheetRowsList(
    token,
    skuMasterRowsCache,
    async () => {
      const sheets = await getSheetsClient();
      const title = await resolveSheetTitle(sheets, SKU_MASTER_GID, SKU_SHEET_ID);
      const res = await sheets.spreadsheets.values.get({ spreadsheetId: SKU_SHEET_ID, range: `${title}!A:Z` });
      return sheetRowsToRecords(res.data.values ?? []);
    },
    'โหลดฐานข้อมูลสินค้า (SKU Master) ไม่สำเร็จ',
  );
}

// ---------- Audit Log ----------
// Append-only trail of every edit to an order's delivery date / note / tax
// invoice / status, made through handleUpdateRouteOrder below. Never
// overwritten and never read back by this app — a human audits it directly
// in the sheet. Uses spreadsheets.values.append specifically (not
// values.update, which needs a target row index computed ahead of time):
// Sheets serializes each append call to the next actually-open row, so two
// staff editing different orders at the same moment can never race each
// other into overwriting one row, the way two concurrent index-based writes
// could if they picked the same "next empty row" before either had written.
const AUDIT_LOG_TAB_TITLE = 'Audit Log';
const AUDIT_LOG_HEADER = ['timestamp', 'username', 'role', 'order_id', 'field', 'old_value', 'new_value'];

async function ensureAuditLogSheet(sheets: SheetsClient): Promise<void> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
  const exists = meta.data.sheets?.some((s) => s.properties?.title === AUDIT_LOG_TAB_TITLE);
  if (exists) return;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: MAIN_SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: AUDIT_LOG_TAB_TITLE } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: MAIN_SHEET_ID,
    range: `${AUDIT_LOG_TAB_TITLE}!A1:G1`,
    valueInputOption: 'RAW',
    requestBody: { values: [AUDIT_LOG_HEADER] },
  });
}

interface AuditLogEntry {
  orderId: string;
  field: string;
  oldValue: string;
  newValue: string;
}

/** Appends one row per actually-changed field (entries where old === new are
 * dropped — nothing to audit). Best-effort: a failure here is logged but
 * never fails the caller's order write — by the time this runs the edit the
 * user asked for has already succeeded, and losing one audit-trail entry is
 * a much smaller problem than reporting a failed save that actually saved. */
async function appendAuditLog(sheets: SheetsClient, actor: { username: string; role: string }, entries: AuditLogEntry[]): Promise<void> {
  const changed = entries.filter((e) => e.oldValue !== e.newValue);
  if (changed.length === 0) return;
  try {
    await ensureAuditLogSheet(sheets);
    const timestamp = new Date().toISOString();
    await sheets.spreadsheets.values.append({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${AUDIT_LOG_TAB_TITLE}!A:G`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: changed.map((e) => [timestamp, actor.username, actor.role, e.orderId, e.field, e.oldValue, e.newValue]) },
    });
  } catch (err: unknown) {
    console.error('[audit-log/append]', err instanceof Error ? err.message : err);
  }
}

/**
 * Create-or-update a "คำสั่งซื้อ VS" row for one order, matched purely by
 * Order UID — an existing row gets its changed fields updated in place; a
 * brand new order (no row yet, since this tab is now populated lazily, only
 * once staff actually enter something for it) gets a fresh row appended.
 * This tab holds ONLY what staff enter through this app's own UI — never a
 * copy of anything API Import already has (see config/sheets.ts).
 */
export async function handleUpdateRouteOrder(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };

  const { orderNo, plannedDeliveryDate, note, wantsTaxInvoice, markDelivered, status, archived, courierVehicleId, courierVehicleName, courierBatchId, clearCourierStamp } =
    (body ?? {}) as Record<string, unknown>;

  if (typeof orderNo !== 'string' || orderNo.trim() === '') {
    return { status: 400, body: { error: 'ต้องระบุ Order UID' } };
  }
  if (!isRouteOrdersTabConfigured()) return { status: 500, body: { error: ROUTE_ORDERS_NOT_CONFIGURED_MESSAGE } };
  // Different fields on this one endpoint serve different features with
  // different permission requirements: markDelivered and the
  // DELIVERY_FAILED_STATUS_VALUE status are the driver's own actions from
  // Driver View; any other status is the batch-pick-lot close write
  // (Checker's job, per the permission matrix); everything else is the
  // Order Management edit form.
  if (markDelivered === true) {
    if (!['administrator', 'manager', 'driver'].includes(payload.role)) {
      return { status: 403, body: { error: 'ไม่มีสิทธิ์ทำเครื่องหมายส่งสำเร็จ' } };
    }
  } else if (status === DELIVERY_FAILED_STATUS_VALUE) {
    if (!['administrator', 'manager', 'driver'].includes(payload.role)) {
      return { status: 403, body: { error: 'ไม่มีสิทธิ์ทำเครื่องหมายส่งไม่สำเร็จ' } };
    }
  } else if (typeof status === 'string') {
    if (!['administrator', 'manager', 'checker'].includes(payload.role)) {
      return { status: 403, body: { error: 'ไม่มีสิทธิ์ปิดล็อตหยิบสินค้า' } };
    }
  } else if (!['administrator', 'manager', 'admin_staff'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์แก้ไขออเดอร์' } };
  }
  const wantsCourierStamp = courierVehicleId !== undefined || courierVehicleName !== undefined || courierBatchId !== undefined;
  if (
    plannedDeliveryDate === undefined &&
    note === undefined &&
    wantsTaxInvoice === undefined &&
    markDelivered === undefined &&
    status === undefined &&
    archived === undefined &&
    !wantsCourierStamp &&
    clearCourierStamp === undefined
  ) {
    return { status: 400, body: { error: 'ไม่มีข้อมูลให้บันทึก' } };
  }
  if (plannedDeliveryDate !== undefined && typeof plannedDeliveryDate !== 'string') {
    return { status: 400, body: { error: 'plannedDeliveryDate ต้องเป็นข้อความรูปแบบ YYYY-MM-DD' } };
  }
  if (note !== undefined && typeof note !== 'string') {
    return { status: 400, body: { error: 'note ต้องเป็นข้อความ' } };
  }
  if (wantsTaxInvoice !== undefined && typeof wantsTaxInvoice !== 'boolean') {
    return { status: 400, body: { error: 'wantsTaxInvoice ต้องเป็น true/false' } };
  }
  if (markDelivered !== undefined && markDelivered !== true) {
    return { status: 400, body: { error: 'markDelivered ต้องเป็น true เท่านั้น' } };
  }
  if (status !== undefined && (typeof status !== 'string' || !KNOWN_OPERATIONAL_STATUS_VALUES.includes(status))) {
    return { status: 400, body: { error: `status ต้องเป็นค่าที่รู้จัก (${KNOWN_OPERATIONAL_STATUS_VALUES.join(', ')})` } };
  }
  if (archived !== undefined && typeof archived !== 'boolean') {
    return { status: 400, body: { error: 'archived ต้องเป็น true/false' } };
  }
  if (wantsCourierStamp && (typeof courierVehicleId !== 'string' || typeof courierVehicleName !== 'string' || typeof courierBatchId !== 'string' || !courierVehicleId.trim() || !courierVehicleName.trim() || !courierBatchId.trim())) {
    return { status: 400, body: { error: 'courierVehicleId/courierVehicleName/courierBatchId ต้องระบุทั้งสามค่าเป็นข้อความที่ไม่ว่าง' } };
  }
  if (clearCourierStamp !== undefined && clearCourierStamp !== true) {
    return { status: 400, body: { error: 'clearCourierStamp ต้องเป็น true เท่านั้น' } };
  }
  if (wantsCourierStamp && clearCourierStamp === true) {
    return { status: 400, body: { error: 'ระบุ courierVehicleId/courierVehicleName/courierBatchId หรือ clearCourierStamp อย่างใดอย่างหนึ่งเท่านั้น' } };
  }

  let sheetDate: string | null = null;
  if (typeof plannedDeliveryDate === 'string') {
    try {
      sheetDate = isoToSheetDate(plannedDeliveryDate);
    } catch (err: unknown) {
      return { status: 400, body: { error: err instanceof Error ? err.message : 'วันที่ไม่ถูกต้อง' } };
    }
  }

  try {
    const sheets = await getSheetsClient();
    const title = await resolveSheetTitle(sheets, ROUTE_ORDERS_GID);

    const current = await sheets.spreadsheets.values.get({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${title}!A:Z`,
    });
    const rows = current.data.values ?? [];
    const header = rows[0] ?? [];
    const headerAt = (name: string) => header.findIndex((h) => String(h ?? '').trim() === name);

    // Columns this app must never write to (ARRAYFORMULA-driven — see
    // STAFF_READONLY_HEADERS), resolved from the real header row so a
    // future column reorder still catches them by name, not position.
    // assertWritableColumn is the second line of defense, past simply never
    // looking these two headers up as a write target below.
    const readOnlyCols = new Set<number>();
    header.forEach((h, i) => {
      if (STAFF_READONLY_HEADERS.has(String(h ?? '').trim())) readOnlyCols.add(i);
    });
    function assertWritableColumn(col: number, headerName: string): void {
      if (readOnlyCols.has(col)) {
        throw new Error(`ป้องกันการเขียนทับคอลัมน์ "${headerName}" ซึ่งเป็นสูตร array formula — ยกเลิกการบันทึก`);
      }
    }

    const uidCol = headerAt(STAFF_ORDER_UID_HEADER);
    if (uidCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_ORDER_UID_HEADER}" ในชีท` } };
    // Written into rowValues[uidCol] on the append-new-row path below, so it
    // goes through the same guard as every other write target.
    assertWritableColumn(uidCol, STAFF_ORDER_UID_HEADER);

    const wanted = orderNo.trim();
    const matches: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i]?.[uidCol] ?? '').trim() === wanted) matches.push(i + 1); // sheet rows are 1-based
    }
    if (matches.length > 1) {
      return { status: 409, body: { error: `พบ "${STAFF_ORDER_UID_HEADER}" "${wanted}" ซ้ำกัน ${matches.length} แถว (แถว ${matches.join(', ')}) — โปรดแก้ไขในชีทโดยตรง` } };
    }
    const targetRow: number | null = matches[0] ?? null;

    // Resolve every target column up front so a missing column fails the
    // whole request before anything is written, rather than leaving a
    // partial edit behind. Every header is expected to already exist (the
    // real sheet is set up by hand with STAFF_ORDER_INFO_HEADERS) — no
    // bootstrap-a-new-column fallback needed anymore.
    let deliveryDateCol = -1;
    if (sheetDate !== null) {
      deliveryDateCol = headerAt(STAFF_DELIVERY_DATE_HEADER);
      if (deliveryDateCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_DELIVERY_DATE_HEADER}" ในชีท` } };
      assertWritableColumn(deliveryDateCol, STAFF_DELIVERY_DATE_HEADER);
    }
    let noteCol = -1;
    if (typeof note === 'string') {
      noteCol = headerAt(STAFF_NOTE_HEADER);
      if (noteCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_NOTE_HEADER}" ในชีท` } };
      assertWritableColumn(noteCol, STAFF_NOTE_HEADER);
    }
    let taxInvoiceCol = -1;
    if (typeof wantsTaxInvoice === 'boolean') {
      taxInvoiceCol = headerAt(STAFF_TAX_INVOICE_HEADER);
      if (taxInvoiceCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_TAX_INVOICE_HEADER}" ในชีท` } };
      assertWritableColumn(taxInvoiceCol, STAFF_TAX_INVOICE_HEADER);
    }
    // No column is dedicated purely to this app's operational-status
    // vocabulary — every status (mark-delivered / delivery-failed /
    // pick-lot-close) writes to "ปัญหาการส่ง", the closest real column.
    let statusCol = -1;
    if (markDelivered === true || typeof status === 'string') {
      statusCol = headerAt(STAFF_OPERATIONAL_STATUS_HEADER);
      if (statusCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_OPERATIONAL_STATUS_HEADER}" ในชีท` } };
      assertWritableColumn(statusCol, STAFF_OPERATIONAL_STATUS_HEADER);
    }
    let archivedCol = -1;
    if (typeof archived === 'boolean') {
      archivedCol = headerAt(STAFF_ARCHIVED_HEADER);
      if (archivedCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_ARCHIVED_HEADER}" ในชีท` } };
      assertWritableColumn(archivedCol, STAFF_ARCHIVED_HEADER);
    }
    // Batch-Assign info used to write one combined string into a single
    // column; the real sheet has four separate columns purpose-built for
    // this (Route/BATCH ROUTE/คนส่ง/วันที่ Assign), so each gets its own cell.
    let routeCol = -1;
    let batchRouteCol = -1;
    let courierCol = -1;
    let assignDateCol = -1;
    let courierUsername = '';
    if (wantsCourierStamp || clearCourierStamp === true) {
      routeCol = headerAt(STAFF_ROUTE_HEADER);
      if (routeCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_ROUTE_HEADER}" ในชีท` } };
      assertWritableColumn(routeCol, STAFF_ROUTE_HEADER);
      batchRouteCol = headerAt(STAFF_BATCH_ROUTE_HEADER);
      if (batchRouteCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_BATCH_ROUTE_HEADER}" ในชีท` } };
      assertWritableColumn(batchRouteCol, STAFF_BATCH_ROUTE_HEADER);
      courierCol = headerAt(STAFF_COURIER_HEADER);
      if (courierCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_COURIER_HEADER}" ในชีท` } };
      assertWritableColumn(courierCol, STAFF_COURIER_HEADER);
      assignDateCol = headerAt(STAFF_ASSIGN_DATE_HEADER);
      if (assignDateCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_ASSIGN_DATE_HEADER}" ในชีท` } };
      assertWritableColumn(assignDateCol, STAFF_ASSIGN_DATE_HEADER);
    }
    if (wantsCourierStamp) {
      // The driver's display name is just their username, resolved here
      // (never sent from the frontend) since listing Users is admin/manager-
      // only and admin_staff — who can also run the Planner and trigger this
      // write — has no access to /api/users.
      const users = await readUsers(sheets);
      const driver = users.find((u) => u.active && u.role === 'driver' && u.driverVehicleId === courierVehicleId);
      courierUsername = driver?.username ?? '';
    }

    // Collect every cell this request needs to write, keyed by column —
    // shared between the update-existing-row and append-new-row paths below.
    const writes = new Map<number, string>();
    if (sheetDate !== null) writes.set(deliveryDateCol, sheetDate);
    if (typeof note === 'string') writes.set(noteCol, note);
    if (typeof wantsTaxInvoice === 'boolean') writes.set(taxInvoiceCol, wantsTaxInvoice ? 'ใช่' : 'ไม่ใช่');
    if (typeof archived === 'boolean') writes.set(archivedCol, archived ? 'ใช่' : '');
    if (wantsCourierStamp) {
      writes.set(routeCol, courierVehicleName as string);
      writes.set(batchRouteCol, courierBatchId as string);
      writes.set(courierCol, courierUsername);
      writes.set(assignDateCol, nowSheetDateTime());
    }
    if (clearCourierStamp === true) {
      writes.set(routeCol, '');
      writes.set(batchRouteCol, '');
      writes.set(courierCol, '');
      writes.set(assignDateCol, '');
    }
    if (typeof status === 'string') writes.set(statusCol, status);
    if (markDelivered === true) writes.set(statusCol, DELIVERED_STATUS_VALUE);

    // Snapshot the pre-write values of the four auditable fields (delivery
    // date / note / tax invoice / status) before anything below mutates the
    // sheet — a brand new order (targetRow == null) has no prior row, so
    // every old_value is just '' (matching what the field actually reads as
    // today: unset).
    const oldRow = targetRow != null ? (rows[targetRow - 1] ?? []) : [];
    const oldValueAt = (col: number) => String(oldRow[col] ?? '').trim();
    const auditEntries: AuditLogEntry[] = [];
    if (sheetDate !== null) auditEntries.push({ orderId: wanted, field: 'deliveryDate', oldValue: oldValueAt(deliveryDateCol), newValue: sheetDate });
    if (typeof note === 'string') auditEntries.push({ orderId: wanted, field: 'note', oldValue: oldValueAt(noteCol), newValue: note });
    if (typeof wantsTaxInvoice === 'boolean') {
      auditEntries.push({ orderId: wanted, field: 'taxInvoice', oldValue: oldValueAt(taxInvoiceCol), newValue: wantsTaxInvoice ? 'ใช่' : 'ไม่ใช่' });
    }
    if (typeof status === 'string') auditEntries.push({ orderId: wanted, field: 'status', oldValue: oldValueAt(statusCol), newValue: status });
    else if (markDelivered === true) auditEntries.push({ orderId: wanted, field: 'status', oldValue: oldValueAt(statusCol), newValue: DELIVERED_STATUS_VALUE });

    if (targetRow != null) {
      // USER_ENTERED for the date so Sheets parses it the same way a person
      // typing it in would; RAW for everything else so free text (a note
      // starting with "=", for instance) can never be read as a formula.
      if (sheetDate !== null) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: MAIN_SHEET_ID,
          range: `${title}!${columnLetter(deliveryDateCol)}${targetRow}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[sheetDate]] },
        });
      }
      const rawWrites = new Map(writes);
      rawWrites.delete(deliveryDateCol);
      for (const [col, value] of rawWrites) {
        assertWritableColumn(col, header[col] != null ? String(header[col]) : `column ${col}`);
        await sheets.spreadsheets.values.update({
          spreadsheetId: MAIN_SHEET_ID,
          range: `${title}!${columnLetter(col)}${targetRow}`,
          valueInputOption: 'RAW',
          requestBody: { values: [[value]] },
        });
      }
    } else {
      // Brand new order — this tab has no row for it yet. Append one, but
      // ONLY spanning columns up to (never including) the first read-only
      // ARRAYFORMULA column — appending a wider row would plant a literal
      // '' into "new customer"/"Phone" for this row and block their
      // formula's spill. Any write that lands at or past that boundary
      // (e.g. "Archived", which sits after them) can't go in this same
      // call — it's applied afterward, targeted at the exact row number
      // Sheets reports back for the row it just inserted, never guessed.
      const firstReadOnlyCol = readOnlyCols.size > 0 ? Math.min(...readOnlyCols) : header.length;
      const appendWidth = Math.max(uidCol + 1, firstReadOnlyCol);
      const rowValues: unknown[] = new Array(appendWidth).fill('');
      // Belt-and-suspenders: even though appendWidth is sized to stop right
      // before the first read-only column today, explicitly blank out any
      // read-only index that a future header reorder might still leave
      // inside this array, rather than trusting the width math alone.
      for (const c of readOnlyCols) if (c < rowValues.length) rowValues[c] = undefined;
      rowValues[uidCol] = wanted;
      const deferredWrites = new Map<number, string>();
      for (const [col, value] of writes) {
        assertWritableColumn(col, header[col] != null ? String(header[col]) : `column ${col}`);
        if (col < appendWidth) rowValues[col] = value;
        else deferredWrites.set(col, value);
      }
      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!A:${columnLetter(appendWidth - 1)}`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [rowValues] },
      });
      if (deferredWrites.size > 0) {
        const updatedRange = appendRes.data.updates?.updatedRange ?? '';
        const rowMatch = updatedRange.match(/![A-Z]+(\d+)/);
        const newRow = rowMatch ? Number(rowMatch[1]) : null;
        if (newRow == null) {
          throw new Error('เพิ่มแถวใหม่สำเร็จ แต่ระบุตำแหน่งแถวที่เพิ่งเพิ่มไม่ได้ — บันทึกบางฟิลด์ไม่สำเร็จ โปรดลองแก้ไขออเดอร์นี้อีกครั้ง');
        }
        for (const [col, value] of deferredWrites) {
          await sheets.spreadsheets.values.update({
            spreadsheetId: MAIN_SHEET_ID,
            range: `${title}!${columnLetter(col)}${newRow}`,
            valueInputOption: 'RAW',
            requestBody: { values: [[value]] },
          });
        }
      }
    }

    await appendAuditLog(sheets, { username: payload.username, role: payload.role }, auditEntries);

    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[route-orders/update]', message);
    return { status: 500, body: { error: message } };
  }
}

const BULK_ACTIONS = ['setDeliveryDate', 'assign', 'setStatus', 'setNote', 'setTaxInvoice', 'setPromotion', 'archive'] as const;
type BulkAction = (typeof BULK_ACTIONS)[number];

export interface BulkUpdateFailure {
  orderNo: string;
  reason: string;
}

/**
 * The Order Management bulk-actions toolbar's one write endpoint, covering
 * all 7 actions (setDeliveryDate/assign/setStatus/setNote/setTaxInvoice/
 * setPromotion/archive — archive replaces the old per-order Promise.all
 * archive loop). Unlike handleUpdateRouteOrder (one order, several small
 * sequential .update calls), this always issues at most ONE
 * values.append (only when some selected orders have no คำสั่งซื้อ VS row
 * yet) and ONE values.batchUpdate for every cell across every order in the
 * whole request — the Sheets API's per-minute write quota is per request,
 * not per cell, so N sequential calls for N selected orders is what this
 * exists to avoid. Every order is still resolved and validated
 * independently, so one bad order (duplicate row, bad date) fails only that
 * order — see `failed` in the response — never the whole batch.
 */
export async function handleBulkUpdateRouteOrders(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!['administrator', 'manager', 'admin_staff'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์แก้ไขออเดอร์' } };
  }
  if (!isRouteOrdersTabConfigured()) return { status: 500, body: { error: ROUTE_ORDERS_NOT_CONFIGURED_MESSAGE } };

  const b = (body ?? {}) as Record<string, unknown>;
  const { orderNos, action } = b;
  if (!Array.isArray(orderNos) || orderNos.length === 0 || !orderNos.every((o) => typeof o === 'string' && o.trim() !== '')) {
    return { status: 400, body: { error: 'ต้องระบุ orderNos เป็นรายการเลขคำสั่งซื้อที่ไม่ว่างอย่างน้อย 1 รายการ' } };
  }
  const wanted = Array.from(new Set((orderNos as string[]).map((o) => o.trim())));
  if (typeof action !== 'string' || !(BULK_ACTIONS as readonly string[]).includes(action)) {
    return { status: 400, body: { error: `action ต้องเป็นค่าที่รู้จัก (${BULK_ACTIONS.join(', ')})` } };
  }
  const bulkAction = action as BulkAction;

  // Validate every action-specific field up front, before touching Sheets at
  // all — a malformed request fails the whole call here rather than midway
  // through writing.
  let dates: Record<string, unknown> | null = null;
  let fixedNote = '';
  let noteMode: 'append' | 'overwrite' = 'append';
  let statusValue = '';
  let wantsTaxInvoice = false;
  let promotionFlagValue = false;
  let archivedValue = false;
  let courierVehicleId = '';
  let courierVehicleName = '';
  let courierBatchId = '';

  if (bulkAction === 'setDeliveryDate') {
    if (!b.dates || typeof b.dates !== 'object' || Array.isArray(b.dates)) {
      return { status: 400, body: { error: 'ต้องระบุ dates เป็น object {เลขคำสั่งซื้อ: YYYY-MM-DD}' } };
    }
    dates = b.dates as Record<string, unknown>;
  } else if (bulkAction === 'assign') {
    const { courierVehicleId: vId, courierVehicleName: vName, courierBatchId: bId } = b;
    if (typeof vId !== 'string' || !vId.trim() || typeof vName !== 'string' || !vName.trim() || typeof bId !== 'string' || !bId.trim()) {
      return { status: 400, body: { error: 'ต้องระบุ courierVehicleId/courierVehicleName/courierBatchId เป็นข้อความที่ไม่ว่างครบทั้งสามค่า' } };
    }
    courierVehicleId = vId.trim();
    courierVehicleName = vName.trim();
    courierBatchId = bId.trim();
  } else if (bulkAction === 'setStatus') {
    if (typeof b.status !== 'string' || !KNOWN_OPERATIONAL_STATUS_VALUES.includes(b.status)) {
      return { status: 400, body: { error: `status ต้องเป็นค่าที่รู้จัก (${KNOWN_OPERATIONAL_STATUS_VALUES.join(', ')})` } };
    }
    statusValue = b.status;
  } else if (bulkAction === 'setNote') {
    if (typeof b.note !== 'string') return { status: 400, body: { error: 'ต้องระบุ note เป็นข้อความ' } };
    fixedNote = b.note;
    if (b.mode !== undefined) {
      if (b.mode !== 'append' && b.mode !== 'overwrite') return { status: 400, body: { error: 'mode ต้องเป็น append หรือ overwrite' } };
      noteMode = b.mode;
    }
  } else if (bulkAction === 'setTaxInvoice') {
    if (typeof b.wantsTaxInvoice !== 'boolean') return { status: 400, body: { error: 'wantsTaxInvoice ต้องเป็น true/false' } };
    wantsTaxInvoice = b.wantsTaxInvoice;
  } else if (bulkAction === 'setPromotion') {
    if (typeof b.promotionFlag !== 'boolean') return { status: 400, body: { error: 'promotionFlag ต้องเป็น true/false' } };
    promotionFlagValue = b.promotionFlag;
  } else if (bulkAction === 'archive') {
    if (typeof b.archived !== 'boolean') return { status: 400, body: { error: 'archived ต้องเป็น true/false' } };
    archivedValue = b.archived;
  }

  try {
    const sheets = await getSheetsClient();
    const title = await resolveSheetTitle(sheets, ROUTE_ORDERS_GID);
    const current = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
    const rows = current.data.values ?? [];
    const header = rows[0] ?? [];
    const headerAt = (name: string) => header.findIndex((h) => String(h ?? '').trim() === name);

    const readOnlyCols = new Set<number>();
    header.forEach((h, i) => {
      if (STAFF_READONLY_HEADERS.has(String(h ?? '').trim())) readOnlyCols.add(i);
    });
    function assertWritableColumn(col: number, headerName: string): void {
      if (readOnlyCols.has(col)) {
        throw new Error(`ป้องกันการเขียนทับคอลัมน์ "${headerName}" ซึ่งเป็นสูตร array formula — ยกเลิกการบันทึก`);
      }
    }
    function resolveCol(headerName: string): number {
      const col = headerAt(headerName);
      if (col === -1) throw new Error(`ไม่พบคอลัมน์ "${headerName}" ในชีท`);
      assertWritableColumn(col, headerName);
      return col;
    }

    const uidCol = headerAt(STAFF_ORDER_UID_HEADER);
    if (uidCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STAFF_ORDER_UID_HEADER}" ในชีท` } };
    assertWritableColumn(uidCol, STAFF_ORDER_UID_HEADER);

    // Resolve only the column(s) this one action needs. USER_ENTERED is
    // needed only for the delivery-date column (so Sheets parses the M/D/YYYY
    // text as a date, same as handleUpdateRouteOrder) — every other action
    // writes RAW so free text (a note starting with "=", say) is never read
    // as a formula.
    let deliveryDateCol = -1;
    let noteCol = -1;
    let taxInvoiceCol = -1;
    let statusCol = -1;
    let promotionCol = -1;
    let archivedCol = -1;
    let routeCol = -1;
    let batchRouteCol = -1;
    let courierCol = -1;
    let assignDateCol = -1;
    let valueInputOption: 'RAW' | 'USER_ENTERED' = 'RAW';
    let courierUsername = '';

    if (bulkAction === 'setDeliveryDate') {
      deliveryDateCol = resolveCol(STAFF_DELIVERY_DATE_HEADER);
      valueInputOption = 'USER_ENTERED';
    } else if (bulkAction === 'setNote') {
      noteCol = resolveCol(STAFF_NOTE_HEADER);
    } else if (bulkAction === 'setTaxInvoice') {
      taxInvoiceCol = resolveCol(STAFF_TAX_INVOICE_HEADER);
    } else if (bulkAction === 'setStatus') {
      statusCol = resolveCol(STAFF_OPERATIONAL_STATUS_HEADER);
    } else if (bulkAction === 'setPromotion') {
      promotionCol = resolveCol(STAFF_PROMOTION_HEADER);
    } else if (bulkAction === 'archive') {
      archivedCol = resolveCol(STAFF_ARCHIVED_HEADER);
    } else if (bulkAction === 'assign') {
      routeCol = resolveCol(STAFF_ROUTE_HEADER);
      batchRouteCol = resolveCol(STAFF_BATCH_ROUTE_HEADER);
      courierCol = resolveCol(STAFF_COURIER_HEADER);
      assignDateCol = resolveCol(STAFF_ASSIGN_DATE_HEADER);
      // Resolved here, not sent from the frontend — listing Users is
      // admin/manager-only, and admin_staff (who can also run this bulk
      // action) has no access to /api/users.
      const users = await readUsers(sheets);
      const driver = users.find((u) => u.active && u.role === 'driver' && u.driverVehicleId === courierVehicleId);
      courierUsername = driver?.username ?? '';
    }

    // Every order maps to at most one existing row, keyed by "เลขคำสั่งซื้อ" —
    // a duplicate is reported as a per-order failure, not a whole-batch abort.
    const rowsByUid = new Map<string, number[]>();
    for (let i = 1; i < rows.length; i++) {
      const uid = String(rows[i]?.[uidCol] ?? '').trim();
      if (!uid) continue;
      const list = rowsByUid.get(uid) ?? [];
      list.push(i + 1); // sheet rows are 1-based
      rowsByUid.set(uid, list);
    }

    const succeeded: string[] = [];
    const failed: BulkUpdateFailure[] = [];
    const cellWrites: { range: string; values: string[][] }[] = [];
    const newRows: { orderNo: string; values: unknown[]; deferred: Map<number, string> }[] = [];
    // Shared across every row this run touches, so an "assign ยกชุด" call
    // stamps every selected order with the exact same Assign timestamp.
    const assignStamp = nowSheetDateTime();

    for (const orderNo of wanted) {
      try {
        const matches = rowsByUid.get(orderNo) ?? [];
        if (matches.length > 1) {
          failed.push({ orderNo, reason: `พบ "${STAFF_ORDER_UID_HEADER}" ซ้ำกัน ${matches.length} แถว — โปรดแก้ไขในชีทโดยตรง` });
          continue;
        }
        const targetRow: number | null = matches[0] ?? null;

        const writes = new Map<number, string>();
        if (bulkAction === 'setDeliveryDate') {
          const iso = dates?.[orderNo];
          if (typeof iso !== 'string' || !iso) {
            failed.push({ orderNo, reason: 'ไม่พบวันที่สำหรับออเดอร์นี้ในคำขอ' });
            continue;
          }
          let sheetDate: string;
          try {
            sheetDate = isoToSheetDate(iso);
          } catch (err: unknown) {
            failed.push({ orderNo, reason: err instanceof Error ? err.message : 'วันที่ไม่ถูกต้อง' });
            continue;
          }
          writes.set(deliveryDateCol, sheetDate);
        } else if (bulkAction === 'setNote') {
          const oldNote = targetRow != null ? String(rows[targetRow - 1]?.[noteCol] ?? '').trim() : '';
          writes.set(noteCol, noteMode === 'append' && oldNote ? `${oldNote}\n${fixedNote}` : fixedNote);
        } else if (bulkAction === 'setTaxInvoice') {
          writes.set(taxInvoiceCol, wantsTaxInvoice ? 'ใช่' : 'ไม่ใช่');
        } else if (bulkAction === 'setStatus') {
          writes.set(statusCol, statusValue);
        } else if (bulkAction === 'setPromotion') {
          writes.set(promotionCol, promotionFlagValue ? 'ใช่' : '');
        } else if (bulkAction === 'archive') {
          writes.set(archivedCol, archivedValue ? 'ใช่' : '');
        } else if (bulkAction === 'assign') {
          writes.set(routeCol, courierVehicleName);
          writes.set(batchRouteCol, courierBatchId);
          writes.set(courierCol, courierUsername);
          writes.set(assignDateCol, assignStamp);
        }

        if (targetRow != null) {
          for (const [col, value] of writes) cellWrites.push({ range: `${title}!${columnLetter(col)}${targetRow}`, values: [[value]] });
        } else {
          // Brand new order — no คำสั่งซื้อ VS row yet. Collected here and
          // appended together, in one call, after this loop — never one
          // append per order. Capped the same way handleUpdateRouteOrder caps
          // a single new row: never spanning into the first read-only column.
          const firstReadOnlyCol = readOnlyCols.size > 0 ? Math.min(...readOnlyCols) : header.length;
          const appendWidth = Math.max(uidCol + 1, firstReadOnlyCol);
          const rowValues: unknown[] = new Array(appendWidth).fill('');
          for (const c of readOnlyCols) if (c < rowValues.length) rowValues[c] = undefined;
          rowValues[uidCol] = orderNo;
          const deferred = new Map<number, string>();
          for (const [col, value] of writes) {
            if (col < appendWidth) rowValues[col] = value;
            else deferred.set(col, value);
          }
          newRows.push({ orderNo, values: rowValues, deferred });
        }
        succeeded.push(orderNo);
      } catch (err: unknown) {
        failed.push({ orderNo, reason: err instanceof Error ? err.message : 'เกิดข้อผิดพลาด' });
      }
    }

    // One values.append for every brand-new row in this batch, then fold
    // each new row's past-appendWidth deferred writes into the one
    // values.batchUpdate call below, targeted at the row numbers Sheets
    // reports back for the block it just inserted — never guessed.
    if (newRows.length > 0) {
      const maxWidth = Math.max(...newRows.map((r) => r.values.length));
      const appendRes = await sheets.spreadsheets.values.append({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!A:${columnLetter(maxWidth - 1)}`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: newRows.map((r) => r.values) },
      });
      const updatedRange = appendRes.data.updates?.updatedRange ?? '';
      const rowMatch = updatedRange.match(/![A-Z]+(\d+)/);
      const startRow = rowMatch ? Number(rowMatch[1]) : null;
      if (startRow == null) {
        for (const r of newRows) {
          const idx = succeeded.indexOf(r.orderNo);
          if (idx !== -1) succeeded.splice(idx, 1);
          failed.push({ orderNo: r.orderNo, reason: 'เพิ่มแถวใหม่สำเร็จ แต่ระบุตำแหน่งแถวที่เพิ่งเพิ่มไม่ได้ — บันทึกบางฟิลด์ไม่สำเร็จ' });
        }
      } else {
        newRows.forEach((r, i) => {
          const rowNum = startRow + i;
          for (const [col, value] of r.deferred) cellWrites.push({ range: `${title}!${columnLetter(col)}${rowNum}`, values: [[value]] });
        });
      }
    }

    if (cellWrites.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: MAIN_SHEET_ID,
        requestBody: { valueInputOption, data: cellWrites },
      });
    }

    if (succeeded.length > 0) {
      const first = succeeded[0];
      const last = succeeded[succeeded.length - 1];
      let description: string;
      if (bulkAction === 'setDeliveryDate') {
        const uniqueDates = Array.from(new Set(succeeded.map((o) => dates?.[o]).filter((v): v is string => typeof v === 'string')));
        description = uniqueDates.length === 1 ? `วันที่จะจัดส่ง = ${uniqueDates[0]}` : `วันที่จะจัดส่ง (ตามวันที่แนะนำต่อรายการ, ${uniqueDates.length} ค่าที่ต่างกัน)`;
      } else if (bulkAction === 'assign') {
        description = `Route/BATCH ROUTE/คนส่ง = ${courierVehicleName}/${courierBatchId}/${courierUsername || '(ไม่พบผู้ขับที่ผูกกับรถนี้)'}`;
      } else if (bulkAction === 'setStatus') {
        description = `ปัญหาการส่ง = ${statusValue}`;
      } else if (bulkAction === 'setNote') {
        description = `${noteMode === 'append' ? 'ต่อท้ายหมายเหตุ' : 'เขียนทับหมายเหตุ'}: "${fixedNote}"`;
      } else if (bulkAction === 'setTaxInvoice') {
        description = `ใบกำกับภาษี = ${wantsTaxInvoice ? 'ใช่' : 'ไม่ใช่'}`;
      } else if (bulkAction === 'setPromotion') {
        description = `โปรโมชั่น = ${promotionFlagValue ? 'ใช่' : 'ไม่ใช่'}`;
      } else {
        description = `Archived = ${archivedValue ? 'ใช่' : 'ไม่ใช่'}`;
      }
      await appendAuditLog(sheets, { username: payload.username, role: payload.role }, [
        { orderId: `${first} – ${last} (${succeeded.length} รายการ)`, field: `bulk:${bulkAction}`, oldValue: '', newValue: description },
      ]);
    }

    return { status: 200, body: { ok: true, succeeded, failed } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[route-orders/bulk-update]', message);
    return { status: 500, body: { error: message } };
  }
}

/** "Export เป็น Excel" on Order Management — same API Import + คำสั่งซื้อ VS
 * join every page reads (joinRouteOrdersForExport, above), written out as a
 * .xlsx instead of rendered as a table. A couple of on-screen columns are
 * deliberately left out because they only exist as client-side computed
 * state with no server-side equivalent: the route/zone label (from local
 * zoneRules + geocode matching), promo-line badges (from a live SKU Detail
 * read), and delivery-failure photo counts (from the browser's local photo
 * queue). exceljs is dynamically imported — this project's other ~10
 * serverless functions never touch it, so a static top-level import would
 * pay its cold-start cost on every one of them for nothing. */
export async function handleExportRouteOrders(token: string | null, orderNos?: string[]): Promise<ApiResult | FileResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!isRouteOrdersTabConfigured()) return { status: 500, body: { error: ROUTE_ORDERS_NOT_CONFIGURED_MESSAGE } };

  try {
    const sheets = await getSheetsClient();
    const [{ data: apiOrders }, staffInfos] = await Promise.all([apiImportOrdersCache.read(loadApiImportOrders), readStaffOrderInfoSheet(sheets)]);
    let rows = joinRouteOrdersForExport(apiOrders, staffInfos);
    // "Export เป็น Excel เฉพาะที่เลือก" on the bulk-actions toolbar — same join,
    // filtered down to just the selected order numbers, so it's exactly one
    // extra Set membership check rather than a second code path.
    if (orderNos && orderNos.length > 0) {
      const wanted = new Set(orderNos);
      rows = rows.filter((r) => wanted.has(r.orderNo));
    }

    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('ออเดอร์');
    sheet.columns = [
      { header: 'เลขคำสั่งซื้อ', key: 'orderNo', width: 16 },
      { header: 'ลูกค้า', key: 'customer', width: 24 },
      { header: 'เบอร์โทร', key: 'phone', width: 14 },
      { header: 'ที่อยู่', key: 'address', width: 32 },
      { header: 'อำเภอ/จังหวัด', key: 'districtProvince', width: 24 },
      { header: 'ยอดขาย', key: 'totalAmount', width: 12 },
      { header: 'จำนวนรายการ', key: 'itemCount', width: 12 },
      { header: 'ประเภทชำระเงิน', key: 'paymentType', width: 16 },
      { header: 'สถานะ', key: 'status', width: 18 },
      { header: 'วันที่สั่ง', key: 'orderedAtText', width: 20 },
      { header: 'วันที่จะจัดส่ง', key: 'plannedDeliveryDate', width: 14 },
      { header: 'วันที่จัดส่ง', key: 'deliveredDate', width: 20 },
      { header: 'วันที่ส่งสำเร็จ', key: 'completedDate', width: 20 },
      { header: 'หมายเหตุ', key: 'note', width: 28 },
      { header: 'ขอใบกำกับภาษี', key: 'wantsTaxInvoice', width: 14 },
      { header: 'คนส่ง / รถ / Batch', key: 'courierStamp', width: 24 },
      { header: 'Archived', key: 'archived', width: 10 },
      { header: 'ลูกค้าใหม่', key: 'isNewCustomer', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    for (const o of rows) {
      sheet.addRow({
        orderNo: o.orderNo,
        customer: o.customer,
        phone: o.phone,
        address: o.addressFromUnii,
        districtProvince: o.districtProvince,
        totalAmount: o.totalAmount,
        itemCount: o.itemCount,
        paymentType: o.paymentType,
        status: o.status,
        orderedAtText: o.orderedAtText,
        plannedDeliveryDate: o.plannedDeliveryDate,
        deliveredDate: o.deliveredDate,
        completedDate: o.completedDate,
        note: o.note,
        wantsTaxInvoice: o.wantsTaxInvoice ? 'ใช่' : '',
        courierStamp: o.courierStamp,
        archived: o.archived ? 'ใช่' : '',
        isNewCustomer: o.isNewCustomer,
      });
    }

    // exceljs's own type declarations shadow the global Buffer interface
    // with a narrower one (see FileResult's comment) — cast through unknown
    // to sidestep that structural mismatch rather than the two never unifying.
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
    return {
      status: 200,
      filename: `orders-${new Date().toISOString().slice(0, 10)}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'สร้างไฟล์ Excel ไม่สำเร็จ';
    console.error('[route-orders/export]', message);
    return { status: 500, body: { error: message } };
  }
}

/**
 * Create-or-update a promotion row in the "โปรโมชั่น" tab, matched by SKU —
 * an existing SKU updates that row in place; a new one is written to the
 * first row past the sheet's current data (never via values.append, so the
 * exact target row is always known up front). The frontend is responsible
 * for turning whatever pricing shape the user entered (stepped tiers or
 * per-packaging-unit prices) into the plain termText + numeric columns this
 * handler writes — this endpoint doesn't need to know which shape it was.
 */
export async function handleUpsertPromotion(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!['administrator', 'manager', 'admin_staff'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์แก้ไขโปรโมชั่น' } };
  }

  const { sku, productName, start, end, termText, promotionPrice, boxPrice, singlePrice } = (body ?? {}) as Record<string, unknown>;

  if (typeof sku !== 'string' || sku.trim() === '') return { status: 400, body: { error: 'ต้องระบุ SKU' } };
  if (typeof productName !== 'string' || productName.trim() === '') return { status: 400, body: { error: 'ต้องระบุชื่อสินค้า' } };
  if (typeof termText !== 'string' || termText.trim() === '') return { status: 400, body: { error: 'ต้องระบุรายละเอียดโปรโมชั่น' } };
  if (start !== undefined && typeof start !== 'string') return { status: 400, body: { error: 'start ต้องเป็นข้อความรูปแบบ YYYY-MM-DD' } };
  if (end !== undefined && typeof end !== 'string') return { status: 400, body: { error: 'end ต้องเป็นข้อความรูปแบบ YYYY-MM-DD' } };
  if (promotionPrice !== undefined && typeof promotionPrice !== 'number') return { status: 400, body: { error: 'promotionPrice ต้องเป็นตัวเลข' } };
  if (boxPrice !== undefined && typeof boxPrice !== 'number') return { status: 400, body: { error: 'boxPrice ต้องเป็นตัวเลข' } };
  if (singlePrice !== undefined && typeof singlePrice !== 'number') return { status: 400, body: { error: 'singlePrice ต้องเป็นตัวเลข' } };

  let sheetStart: string | null = null;
  let sheetEnd: string | null = null;
  let periodDays: number | null = null;
  try {
    if (typeof start === 'string' && start) sheetStart = isoToPromoSheetDate(start);
    if (typeof end === 'string' && end) sheetEnd = isoToPromoSheetDate(end);
    if (typeof start === 'string' && start && typeof end === 'string' && end) periodDays = daysBetweenIso(start, end);
  } catch (err: unknown) {
    return { status: 400, body: { error: err instanceof Error ? err.message : 'วันที่ไม่ถูกต้อง' } };
  }

  try {
    const sheets = await getSheetsClient();
    const title = await resolveSheetTitle(sheets, PROMOTIONS_GID);

    const current = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
    const rows = current.data.values ?? [];
    const header = rows[0] ?? [];
    const headerAt = (name: string) => header.findIndex((h) => String(h ?? '').trim() === name);

    const skuCol = headerAt(PROMO_SKU_HEADER);
    if (skuCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${PROMO_SKU_HEADER}" ในชีท` } };
    const statusCol = headerAt(PROMO_STATUS_HEADER);
    if (statusCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${PROMO_STATUS_HEADER}" ในชีท` } };
    const nameCol = headerAt(PROMO_PRODUCT_NAME_HEADER);
    if (nameCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${PROMO_PRODUCT_NAME_HEADER}" ในชีท` } };
    const termCol = headerAt(PROMO_TERM_HEADER);
    if (termCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${PROMO_TERM_HEADER}" ในชีท` } };
    // These four are optional — some sheets may not have every one of them,
    // and a missing column just means that particular field is skipped
    // rather than failing the whole save.
    const startCol = headerAt(PROMO_START_HEADER);
    const endCol = headerAt(PROMO_END_HEADER);
    const priceCol = headerAt(PROMO_PRICE_HEADER);
    const boxCol = headerAt(PROMO_BOX_PRICE_HEADER);
    const singleCol = headerAt(PROMO_SINGLE_PRICE_HEADER);
    const periodCol = headerAt(PROMO_PERIOD_HEADER);

    const wanted = sku.trim();
    const matches: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i]?.[skuCol] ?? '').trim() === wanted) matches.push(i + 1); // sheet rows are 1-based
    }
    if (matches.length > 1) {
      return { status: 409, body: { error: `พบ SKU "${wanted}" ซ้ำกัน ${matches.length} แถว (แถว ${matches.join(', ')}) — โปรดแก้ไขในชีทโดยตรง` } };
    }
    const isNew = matches.length === 0;
    const targetRow = isNew ? rows.length + 1 : matches[0];

    // RAW for free text so a SKU/name/term starting with "=" can never be
    // read as a formula; USER_ENTERED only for the two date cells, so Sheets
    // parses them the same way a person typing a date in would.
    const writeCell = async (col: number, value: string | number, valueInputOption: 'RAW' | 'USER_ENTERED' = 'RAW') => {
      if (col === -1) return;
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(col)}${targetRow}`,
        valueInputOption,
        requestBody: { values: [[value]] },
      });
    };

    await writeCell(skuCol, wanted);
    await writeCell(statusCol, 'Active');
    await writeCell(nameCol, productName.trim());
    await writeCell(termCol, termText.trim());
    if (sheetStart !== null) await writeCell(startCol, sheetStart, 'USER_ENTERED');
    if (sheetEnd !== null) await writeCell(endCol, sheetEnd, 'USER_ENTERED');
    if (periodDays !== null) await writeCell(periodCol, periodDays);
    if (typeof promotionPrice === 'number') await writeCell(priceCol, promotionPrice);
    if (typeof boxPrice === 'number') await writeCell(boxCol, boxPrice);
    if (typeof singlePrice === 'number') await writeCell(singleCol, singlePrice);

    return { status: 200, body: { ok: true, updatedRow: targetRow, created: isNew } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[promotions/upsert]', message);
    return { status: 500, body: { error: message } };
  }
}

/**
 * Confirms (or clears, when promoSku === '') that one specific order line
 * used a given promotion — explicit staff confirmation only, never inferred
 * from a matching price, so usage stats can never silently include an
 * unconfirmed coincidence. Matched by the line's own "No." when given (the
 * most precise identity for a single row); falls back to an orderNo+SKU pair
 * otherwise, refusing (same as every other handler here) if that pair is
 * ambiguous rather than guessing which row to touch.
 */
export async function handleLinkLineItemPromo(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!['administrator', 'manager', 'admin_staff'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์แก้ไขรายการสินค้า' } };
  }

  const { orderNo, sku, no, promoSku } = (body ?? {}) as Record<string, unknown>;
  if (typeof orderNo !== 'string' || orderNo.trim() === '') return { status: 400, body: { error: 'ต้องระบุเลขคำสั่งซื้อ' } };
  if (typeof sku !== 'string' || sku.trim() === '') return { status: 400, body: { error: 'ต้องระบุ SKU' } };
  if (typeof promoSku !== 'string') return { status: 400, body: { error: 'promoSku ต้องเป็นข้อความ (ว่าง = ยกเลิกผูก)' } };
  if (no !== undefined && typeof no !== 'string') return { status: 400, body: { error: 'no ต้องเป็นข้อความ' } };

  try {
    const sheets = await getSheetsClient();
    const title = await resolveSheetTitle(sheets, SKU_DETAIL_GID);

    const current = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
    const rows = current.data.values ?? [];
    const header = rows[0] ?? [];
    const headerAt = (name: string) => header.findIndex((h) => String(h ?? '').trim() === name);

    const orderNoCol = headerAt(LINE_ITEM_ORDER_NO_HEADER);
    if (orderNoCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${LINE_ITEM_ORDER_NO_HEADER}" ในชีท` } };
    const skuCol = headerAt(LINE_ITEM_SKU_HEADER);
    if (skuCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${LINE_ITEM_SKU_HEADER}" ในชีท` } };
    const noCol = headerAt(LINE_ITEM_NO_HEADER);

    const wantedOrderNo = orderNo.trim();
    const wantedSku = sku.trim();
    const wantedNo = typeof no === 'string' ? no.trim() : '';

    let targetRow: number;
    if (wantedNo && noCol !== -1) {
      const matches: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i]?.[noCol] ?? '').trim() === wantedNo) matches.push(i + 1);
      }
      if (matches.length === 0) return { status: 404, body: { error: `ไม่พบรายการ No. "${wantedNo}" ในชีท SKU Detail` } };
      if (matches.length > 1) {
        return { status: 409, body: { error: `พบ No. "${wantedNo}" ซ้ำกัน ${matches.length} แถว — โปรดแก้ไขในชีทโดยตรง` } };
      }
      targetRow = matches[0];
    } else {
      const matches: number[] = [];
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i]?.[orderNoCol] ?? '').trim() === wantedOrderNo && String(rows[i]?.[skuCol] ?? '').trim() === wantedSku) matches.push(i + 1);
      }
      if (matches.length === 0) return { status: 404, body: { error: `ไม่พบรายการสินค้า SKU "${wantedSku}" ในออเดอร์ "${wantedOrderNo}"` } };
      if (matches.length > 1) {
        return { status: 409, body: { error: `พบ SKU "${wantedSku}" ซ้ำกัน ${matches.length} แถวในออเดอร์นี้ — โปรดแก้ไขในชีทโดยตรง` } };
      }
      targetRow = matches[0];
    }

    let promoSkuCol = headerAt(LINE_ITEM_PROMO_SKU_HEADER);
    if (promoSkuCol === -1) {
      promoSkuCol = header.length;
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(promoSkuCol)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[LINE_ITEM_PROMO_SKU_HEADER]] },
      });
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${title}!${columnLetter(promoSkuCol)}${targetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[promoSku.trim()]] },
    });

    return { status: 200, body: { ok: true, updatedRow: targetRow } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[sku-detail/link-promo]', message);
    return { status: 500, body: { error: message } };
  }
}

// Reverse geocoding proxy: the frontend never calls Nominatim directly,
// both because browsers can't set the custom User-Agent its usage policy
// requires, and so every caller (however many browser tabs are open) shares
// one throttle instead of each independently hammering the free API.
let lastNominatimCallAt = 0;

/** Nominatim's address fields don't line up 1:1 with Thai ตำบล/อำเภอ/จังหวัด —
 * which OSM tag a given place uses (suburb vs quarter vs village vs hamlet
 * for sub-district; county vs city_district vs state_district for district)
 * varies by how the area was mapped, so each level tries several candidates
 * in priority order and takes the first that's present. */
function pickAddressField(address: Record<string, unknown>, candidates: string[]): string {
  for (const key of candidates) {
    const v = address[key];
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return '';
}

export async function handleReverseGeocode(body: unknown): Promise<ApiResult> {
  const { lat, lng } = (body ?? {}) as Record<string, unknown>;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { status: 400, body: { error: 'lat/lng ต้องเป็นตัวเลข' } };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { status: 400, body: { error: 'lat/lng อยู่นอกช่วงที่เป็นไปได้' } };
  }

  const wait = lastNominatimCallAt + GEOCODE_MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCallAt = Date.now();

  const url = `${NOMINATIM_REVERSE_URL}?lat=${lat}&lon=${lng}&format=json&addressdetails=1&accept-language=th`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': NOMINATIM_USER_AGENT, 'Accept-Language': 'th' },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { status: 502, body: { error: `Nominatim ตอบกลับ HTTP ${res.status}` } };
    }
    const data = (await res.json()) as { address?: Record<string, unknown>; error?: string };
    if (!data.address) {
      return { status: 404, body: { error: data.error || 'ไม่พบข้อมูลที่อยู่สำหรับพิกัดนี้' } };
    }
    const address = data.address;
    const subdistrict = pickAddressField(address, ['suburb', 'quarter', 'neighbourhood', 'village', 'hamlet', 'town']);
    const district = pickAddressField(address, ['county', 'city_district', 'state_district', 'district']);
    const province = pickAddressField(address, ['state', 'province', 'region']);

    return { status: 200, body: { subdistrict, district, province } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[geocode/reverse]', message);
    return { status: 502, body: { error: `เรียก Nominatim ไม่สำเร็จ: ${message}` } };
  } finally {
    clearTimeout(timeout);
  }
}

export interface UploadFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export async function handleDriveUpload(token: string | null, files: UploadFile[], scope: string, key: string): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (files.length === 0) return { status: 400, body: { error: 'ไม่พบไฟล์ที่จะอัปโหลด' } };
  if (scope !== 'order' && scope !== 'receiving' && scope !== 'deliveryFailure') {
    return { status: 400, body: { error: 'scope ต้องเป็น order, receiving หรือ deliveryFailure' } };
  }
  if (!key) return { status: 400, body: { error: 'ต้องระบุ key (เลขออเดอร์ หรือ วันที่-ซัพพลายเออร์)' } };
  // Order attachments follow Order Management's edit permission; receiving
  // attachments also allow Checker, who can log goods receiving;
  // deliveryFailure photos are a driver's own action from Driver View, same
  // role set markDelivered already allows there.
  const allowedRoles =
    scope === 'order'
      ? ['administrator', 'manager', 'admin_staff']
      : scope === 'deliveryFailure'
        ? ['administrator', 'manager', 'driver']
        : ['administrator', 'manager', 'admin_staff', 'checker'];
  if (!allowedRoles.includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์แนบไฟล์' } };
  }

  const rejected = files.find((f) => !isAllowedFile(f.mimetype, f.originalname));
  if (rejected) {
    return { status: 415, body: { error: `"${rejected.originalname}" ไม่ใช่ไฟล์ PDF/JPG/PNG` } };
  }

  const rootFolderId = process.env[DRIVE_ROOT_FOLDER_ENV]?.trim();
  const hasCredentials = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();

  // Mock mode: keeps the whole attach → list → open flow testable before the
  // Service Account and Drive folder exist. Never used once both are set.
  if (!hasCredentials || !rootFolderId) {
    return {
      status: 200,
      body: {
        ok: true,
        mock: true,
        files: files.map((f) => ({
          fileId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: f.originalname,
          mimeType: f.mimetype,
          size: f.size,
          webViewLink: '',
        })),
      },
    };
  }

  try {
    const drive = await getDriveClient();
    const folderId = await ensureFolderPath(drive, rootFolderId, driveFolderPath(scope as AttachmentScope, key));

    const uploaded = [];
    for (const f of files) {
      const created = await drive.files.create({
        requestBody: { name: f.originalname, parents: [folderId] },
        media: { mimeType: f.mimetype, body: Readable.from(f.buffer) },
        fields: 'id, name, mimeType, size, webViewLink',
        supportsAllDrives: true,
      });
      uploaded.push({
        fileId: created.data.id ?? '',
        name: created.data.name ?? f.originalname,
        mimeType: created.data.mimeType ?? f.mimetype,
        size: Number(created.data.size ?? f.size),
        webViewLink: created.data.webViewLink ?? '',
      });
    }

    return { status: 200, body: { ok: true, mock: false, files: uploaded } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'อัปโหลดไฟล์ไม่สำเร็จ';
    console.error('[drive/upload]', message);
    return { status: 502, body: { error: `อัปโหลดขึ้น Google Drive ไม่สำเร็จ: ${message}` } };
  }
}
