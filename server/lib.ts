import { google } from 'googleapis';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { DRIVE_ROOT_FOLDER_ENV, driveFolderPath, isAllowedFile, type AttachmentScope } from '../src/config/drive.js';
import { GEOCODE_MIN_INTERVAL_MS, NOMINATIM_REVERSE_URL, NOMINATIM_USER_AGENT } from '../src/config/geocoding.js';
import { MAIN_SHEET_ID, SHEET_TABS } from '../src/config/sheets.js';
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

// Columns in the CS Master tab: A=ชื่อ B=เบอร์ C=ที่อยู่ D=ละ(lat) E=ลอง(lng)
const LAT_COLUMN = 'D';
const LNG_COLUMN = 'E';
const NAME_COLUMN_INDEX = 0;
const PHONE_COLUMN_INDEX = 1;

// Columns in the "คำสั่งซื้อ" tab, looked up by header text each request (not
// by position) so a future column reorder in the sheet doesn't silently write
// to the wrong cell.
const ORDER_NO_HEADER = 'เลขคำสั่งซื้อ';
const NOTE_HEADER = 'หมายเหตุ';
// "วันที่จะจัดส่ง" (planned delivery date) — NOT the sheet's separate
// "วันที่จัดส่ง" column, which is a datetime stamped once a driver actually
// delivers and would be corrupted by a manually-picked future date.
const DELIVERY_DATE_HEADER = 'วันที่จะจัดส่ง';
const TAX_INVOICE_HEADER = 'ขอใบกำกับภาษี';
const STATUS_HEADER = 'Status';
// "วันที่จัดส่ง" is the delivery-completion timestamp (see DELIVERY_DATE_HEADER
// above) — exactly what should be stamped when a driver marks a stop done.
const DELIVERED_TIMESTAMP_HEADER = 'วันที่จัดส่ง';
const DELIVERED_STATUS_VALUE = 'ส่งสำเร็จ';
// Real status vocabulary observed in the sheet — a small allowlist so a
// caller passing an arbitrary `status` string (e.g. batch picking closing a
// lot) can't accidentally write a typo/garbage value into the column.
const KNOWN_STATUS_VALUES = ['รอยืนยันออเดอร์', 'กำลังดำเนินการ', 'รอชำระเงิน', 'กำลังจัดส่ง', DELIVERED_STATUS_VALUE, 'ได้รับแล้ว', 'ยกเลิก'];
// The real sheet has no dedicated boolean tax-invoice column — only a legacy
// field ("ใบกำกับภาษี/หมายเหตุเดิม") that mixes it with old free-text notes
// and already holds real note content on some rows, so it's not safe to
// overwrite. The column right after it is blank in every row today; claim it
// by labelling its header on first write, and refuse if that ever turns out
// not to be true anymore (someone typed something else into it since).
const TAX_INVOICE_FALLBACK_COLUMN_INDEX = 13; // column N, 0-based
// Archive feature — no legacy blank column to reuse like the tax-invoice
// special case above, so this one bootstraps as a brand-new column appended
// right after whatever the sheet's last used column currently is.
const ARCHIVED_HEADER = 'Archived';

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

/** gid identifies a tab stably; the Sheets values API needs its title. */
async function resolveSheetTitle(sheets: ReturnType<typeof google.sheets>, gid: number): Promise<string> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
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
const USERS_HEADER = ['username', 'passwordHash', 'role', 'active', 'driverVehicleId', 'createdAt'];
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

export async function handleLogin(body: unknown): Promise<ApiResult> {
  const { username, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    return { status: 400, body: { error: 'ต้องระบุ username และ password' } };
  }
  try {
    const sheets = await getSheetsClient();
    const users = await readUsers(sheets);
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
    const users = await readUsers(sheets);
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

    // Row 1 is the header; match on name + phone so we update in place
    // rather than appending a duplicate.
    const wantedName = name.trim();
    const wantedPhone = typeof phone === 'string' ? phoneKey(phone) : '';
    const matches: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      const rowName = String(rows[i]?.[NAME_COLUMN_INDEX] ?? '').trim();
      const rowPhone = phoneKey(String(rows[i]?.[PHONE_COLUMN_INDEX] ?? ''));
      if (rowName === wantedName && (wantedPhone === '' || rowPhone === wantedPhone)) {
        matches.push(i + 1); // sheet rows are 1-based
      }
    }

    if (matches.length === 0) {
      return { status: 404, body: { error: `ไม่พบลูกค้า "${wantedName}" ในชีท CS Master` } };
    }
    // Refuse to guess when the identifiers are ambiguous — writing to the
    // wrong customer's row is worse than making someone disambiguate.
    if (matches.length > 1) {
      return { status: 409, body: { error: `พบลูกค้าชื่อ "${wantedName}" ซ้ำกัน ${matches.length} แถว (แถว ${matches.join(', ')}) — โปรดแก้ไขในชีทโดยตรง` } };
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

export async function handleUpdateRouteOrder(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };

  const { orderNo, plannedDeliveryDate, note, wantsTaxInvoice, markDelivered, status, archived } = (body ?? {}) as Record<string, unknown>;

  if (typeof orderNo !== 'string' || orderNo.trim() === '') {
    return { status: 400, body: { error: 'ต้องระบุเลขคำสั่งซื้อ' } };
  }
  // Different fields on this one endpoint serve different features with
  // different permission requirements: markDelivered is the driver's own
  // action from Driver View; status is the batch-pick-lot close write
  // (Checker's job, per the permission matrix); everything else is the
  // Order Management edit form.
  if (markDelivered === true) {
    if (!['administrator', 'manager', 'driver'].includes(payload.role)) {
      return { status: 403, body: { error: 'ไม่มีสิทธิ์ทำเครื่องหมายส่งสำเร็จ' } };
    }
  } else if (typeof status === 'string') {
    if (!['administrator', 'manager', 'checker'].includes(payload.role)) {
      return { status: 403, body: { error: 'ไม่มีสิทธิ์ปิดล็อตหยิบสินค้า' } };
    }
  } else if (!['administrator', 'manager', 'admin_staff'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์แก้ไขออเดอร์' } };
  }
  if (
    plannedDeliveryDate === undefined &&
    note === undefined &&
    wantsTaxInvoice === undefined &&
    markDelivered === undefined &&
    status === undefined &&
    archived === undefined
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
  if (status !== undefined && (typeof status !== 'string' || !KNOWN_STATUS_VALUES.includes(status))) {
    return { status: 400, body: { error: `status ต้องเป็นค่าที่รู้จัก (${KNOWN_STATUS_VALUES.join(', ')})` } };
  }
  if (archived !== undefined && typeof archived !== 'boolean') {
    return { status: 400, body: { error: 'archived ต้องเป็น true/false' } };
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
      range: `${title}!A:AB`,
    });
    const rows = current.data.values ?? [];
    const header = rows[0] ?? [];
    const headerAt = (name: string) => header.findIndex((h) => String(h ?? '').trim() === name);

    const orderNoCol = headerAt(ORDER_NO_HEADER);
    if (orderNoCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${ORDER_NO_HEADER}" ในชีท` } };

    const wanted = orderNo.trim();
    const matches: number[] = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i]?.[orderNoCol] ?? '').trim() === wanted) matches.push(i + 1); // sheet rows are 1-based
    }
    if (matches.length === 0) return { status: 404, body: { error: `ไม่พบคำสั่งซื้อ "${wanted}" ในชีทคำสั่งซื้อ` } };
    if (matches.length > 1) {
      return { status: 409, body: { error: `พบเลขคำสั่งซื้อ "${wanted}" ซ้ำกัน ${matches.length} แถว (แถว ${matches.join(', ')}) — โปรดแก้ไขในชีทโดยตรง` } };
    }
    const targetRow = matches[0];

    // Resolve every target column up front so a missing column fails the
    // whole request before anything is written, rather than leaving a
    // partial edit behind.
    let deliveryDateCol = -1;
    if (sheetDate !== null) {
      deliveryDateCol = headerAt(DELIVERY_DATE_HEADER);
      if (deliveryDateCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${DELIVERY_DATE_HEADER}" ในชีท` } };
    }
    let noteCol = -1;
    if (typeof note === 'string') {
      noteCol = headerAt(NOTE_HEADER);
      if (noteCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${NOTE_HEADER}" ในชีท` } };
    }
    let taxInvoiceCol = -1;
    if (typeof wantsTaxInvoice === 'boolean') {
      taxInvoiceCol = headerAt(TAX_INVOICE_HEADER);
      if (taxInvoiceCol === -1) {
        const fallbackHeader = String(header[TAX_INVOICE_FALLBACK_COLUMN_INDEX] ?? '').trim();
        if (fallbackHeader !== '') {
          return {
            status: 500,
            body: { error: `ไม่พบคอลัมน์ "${TAX_INVOICE_HEADER}" และคอลัมน์สำรอง (${columnLetter(TAX_INVOICE_FALLBACK_COLUMN_INDEX)}) ก็มีชื่ออื่นอยู่แล้ว ("${fallbackHeader}") — ต้องเพิ่มคอลัมน์นี้ในชีทเอง` },
          };
        }
        taxInvoiceCol = TAX_INVOICE_FALLBACK_COLUMN_INDEX;
      }
    }
    let statusCol = -1;
    let deliveredTimestampCol = -1;
    if (markDelivered === true || typeof status === 'string') {
      statusCol = headerAt(STATUS_HEADER);
      if (statusCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${STATUS_HEADER}" ในชีท` } };
    }
    if (markDelivered === true) {
      deliveredTimestampCol = headerAt(DELIVERED_TIMESTAMP_HEADER);
      if (deliveredTimestampCol === -1) return { status: 500, body: { error: `ไม่พบคอลัมน์ "${DELIVERED_TIMESTAMP_HEADER}" ในชีท` } };
    }
    let archivedCol = -1;
    if (typeof archived === 'boolean') {
      archivedCol = headerAt(ARCHIVED_HEADER);
      // No known-blank legacy column to reuse here (unlike tax-invoice above)
      // — just claim the next empty column past whatever's currently used.
      if (archivedCol === -1) archivedCol = header.length;
    }

    // Bootstrap the tax-invoice header the first time it's needed. Plain
    // values.update (not append) so it can never create a new row.
    if (typeof wantsTaxInvoice === 'boolean' && headerAt(TAX_INVOICE_HEADER) === -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(taxInvoiceCol)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[TAX_INVOICE_HEADER]] },
      });
    }
    // Bootstrap the archived header the first time it's needed, same pattern.
    if (typeof archived === 'boolean' && headerAt(ARCHIVED_HEADER) === -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(archivedCol)}1`,
        valueInputOption: 'RAW',
        requestBody: { values: [[ARCHIVED_HEADER]] },
      });
    }

    // USER_ENTERED for the date so Sheets parses it the same way a person
    // typing it in would (matching the existing column's date formatting);
    // RAW for free text so a note starting with "=" can never be read as a
    // formula.
    if (sheetDate !== null) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(deliveryDateCol)}${targetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[sheetDate]] },
      });
    }
    if (typeof note === 'string') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(noteCol)}${targetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[note]] },
      });
    }
    if (typeof wantsTaxInvoice === 'boolean') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(taxInvoiceCol)}${targetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[wantsTaxInvoice ? 'ใช่' : '']] },
      });
    }
    if (typeof status === 'string') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(statusCol)}${targetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[status]] },
      });
    }
    if (typeof archived === 'boolean') {
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(archivedCol)}${targetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[archived ? 'ใช่' : '']] },
      });
    }
    if (markDelivered === true) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(statusCol)}${targetRow}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[DELIVERED_STATUS_VALUE]] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(deliveredTimestampCol)}${targetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[nowSheetDateTime()]] },
      });
    }

    return { status: 200, body: { ok: true, updatedRow: targetRow } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[route-orders/update]', message);
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
  if (scope !== 'order' && scope !== 'receiving') return { status: 400, body: { error: 'scope ต้องเป็น order หรือ receiving' } };
  if (!key) return { status: 400, body: { error: 'ต้องระบุ key (เลขออเดอร์ หรือ วันที่-ซัพพลายเออร์)' } };
  // Order attachments follow Order Management's edit permission; receiving
  // attachments also allow Checker, who can log goods receiving.
  const allowedRoles = scope === 'order' ? ['administrator', 'manager', 'admin_staff'] : ['administrator', 'manager', 'admin_staff', 'checker'];
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
