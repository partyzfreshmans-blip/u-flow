import { google } from 'googleapis';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { DRIVE_ROOT_FOLDER_ENV, driveFolderPath, isAllowedFile, type AttachmentScope } from '../src/config/drive.js';
import { GEOCODE_MIN_INTERVAL_MS, NOMINATIM_REVERSE_URL, NOMINATIM_USER_AGENT } from '../src/config/geocoding.js';
import { MAIN_SHEET_ID, SHEET_TABS } from '../src/config/sheets.js';
import type { ApiImportOrder, RouteOrder, StaffOrderInfo } from '../src/data/types.js';
import { DELIVERY_DONE_STATUSES } from '../src/state/helpers.js';
import { getDb } from './db.js';
import { createSessionToken, verifySessionToken } from './session.js';
import { fetchAllUniiOrders } from './unii.js';

// Shared core for the backend. Most write-back features (users, orders,
// customers, batch routes, bookings, promotions, activity log, batch
// picking, goods receiving) live in Postgres now — see db/migrations/ and
// server/db.ts — reached through the single shared getDb() client. Two
// features deliberately still use Google Sheets/Drive directly, unchanged:
// SKU Detail's promo-SKU link (handleLinkLineItemPromo — out of scope for
// this round, see db/README.md) and Drive file uploads (attachments are
// metadata-only in Postgres; the files themselves stay on Drive). The
// Google Service Account private key lives ONLY here, in the
// GOOGLE_SERVICE_ACCOUNT_KEY env var — never in the browser bundle. The
// Postgres connection string lives ONLY in DATABASE_URL, read by
// server/db.ts — also never in the browser bundle.

export const SKU_DETAIL_GID = Number(SHEET_TABS.skuDetail.gid);

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
 * file body rather than a JSON one, so every route dispatcher (api/*.ts and
 * server/index.ts) checks for this shape first (see its `isFileResult`
 * helper) and sends the buffer directly instead of calling res.json(). */
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

/** postgres.js's bulk-insert helper (sql(rows)) types each cell as
 * `string | number` even though it serializes null/boolean/Date correctly
 * at runtime — this cast works around that overly-narrow TS signature, not
 * around a real risk (verified locally before this code was written; see
 * scripts/migrate-to-postgres.ts's identical note). */
function bulkRows(rows: unknown[][]): (string | number)[][] {
  return rows as unknown as (string | number)[][];
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

/** Whole days between two YYYY-MM-DD ISO dates — matches promotions'
 * period_days column, which mirrors the old sheet's "Period (วัน)" as
 * end-minus-start in days. Postgres DATE columns take ISO YYYY-MM-DD
 * directly, so (unlike the old Sheets code) no format conversion is needed
 * for the dates themselves — only this derived day-count is still computed
 * here. */
function daysBetweenIso(startIso: string, endIso: string): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((new Date(`${endIso}T00:00:00Z`).getTime() - new Date(`${startIso}T00:00:00Z`).getTime()) / MS_PER_DAY);
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

// ---------- Users / authentication ----------
//
// User accounts (username, hashed password, role) live in Postgres's `users`
// table now (see db/migrations/0001_init.sql). Unlike a CSV-exported Sheets
// tab, Postgres has no public read path at all — the frontend only ever
// reaches this data through these authenticated handlers. That's strictly
// better than the old Sheets-backed design, which called out one residual
// risk worth remembering: anyone with direct Google Sheets "Viewer" access
// to the underlying spreadsheet could see the Users tab regardless of this
// app's own auth. Postgres has no equivalent hole — reaching this data at
// all requires the DATABASE_URL credential, held only by this backend.
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
  username: string;
  passwordHash: string;
  role: string;
  active: boolean;
  driverVehicleId: string;
  createdAt: string;
}

interface UserPgRow {
  username: string;
  password_hash: string;
  role: string;
  active: boolean;
  driver_vehicle_id: string;
  created_at: Date | string | null;
}

/** One example account per role, seeded only if the `users` table is
 * completely empty (a brand new database — see readUsersPg) so there's
 * something to log in with immediately. Throwaway testing credentials —
 * rotate (or delete and recreate) them before relying on this for anything
 * beyond a first smoke test. Mirrors the seed set the old Sheets-backed
 * ensureUsersSheet used to create on a fresh "Users" tab. */
const DEFAULT_USER_SEEDS: { username: string; password: string; role: ValidRole; driverVehicleId: string }[] = [
  { username: 'admin', password: 'Admin#2026', role: 'administrator', driverVehicleId: '' },
  { username: 'manager1', password: 'Manager#2026', role: 'manager', driverVehicleId: '' },
  { username: 'staff1', password: 'Staff#2026', role: 'admin_staff', driverVehicleId: '' },
  { username: 'checker1', password: 'Checker#2026', role: 'checker', driverVehicleId: '' },
  { username: 'picker1', password: 'Picker#2026', role: 'picker', driverVehicleId: '' },
  { username: 'driver1', password: 'Driver#2026', role: 'driver', driverVehicleId: 'veh-a' },
];

function rowToUser(r: UserPgRow): UserRecord {
  return {
    username: r.username,
    passwordHash: r.password_hash,
    role: r.role,
    active: r.active,
    driverVehicleId: r.driver_vehicle_id,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
  };
}

async function readUsersPg(sql: ReturnType<typeof getDb>): Promise<UserRecord[]> {
  const rows = await sql<UserPgRow[]>`SELECT username, password_hash, role, active, driver_vehicle_id, created_at FROM users ORDER BY username`;
  if (rows.length > 0) return rows.map(rowToUser);

  // Brand new database (schema applied, never seeded) — bootstrap the same
  // throwaway accounts the old Sheets version created on first touch.
  const seedRows = DEFAULT_USER_SEEDS.map((s) => [s.username, hashPassword(s.password), s.role, true, s.driverVehicleId]);
  await sql`INSERT INTO users (username, password_hash, role, active, driver_vehicle_id) VALUES ${sql(bulkRows(seedRows))}`;
  const seeded = await sql<UserPgRow[]>`SELECT username, password_hash, role, active, driver_vehicle_id, created_at FROM users ORDER BY username`;
  return seeded.map(rowToUser);
}

export async function handleLogin(body: unknown): Promise<ApiResult> {
  const { username, password } = (body ?? {}) as Record<string, unknown>;
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) {
    return { status: 400, body: { error: 'ต้องระบุ username และ password' } };
  }
  try {
    const users = await readUsersPg(getDb());
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
    const users = await readUsersPg(getDb());
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
    const sql = getDb();
    const users = await readUsersPg(sql);
    if (users.some((u) => u.username.toLowerCase() === username.trim().toLowerCase())) {
      return { status: 409, body: { error: `username "${username}" มีอยู่แล้ว` } };
    }
    await sql`
      INSERT INTO users (username, password_hash, role, active, driver_vehicle_id)
      VALUES (${username.trim()}, ${hashPassword(password)}, ${role}, true, ${typeof driverVehicleId === 'string' ? driverVehicleId : ''})
    `;
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
    const sql = getDb();
    const users = await readUsersPg(sql);
    const user = users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
    if (!user) return { status: 404, body: { error: `ไม่พบผู้ใช้ "${username}"` } };

    const nextRole = typeof role === 'string' ? role : user.role;
    const nextActive = typeof active === 'boolean' ? active : user.active;
    const nextDriverVehicleId = typeof driverVehicleId === 'string' ? driverVehicleId : user.driverVehicleId;
    const nextPasswordHash = typeof newPassword === 'string' ? hashPassword(newPassword) : user.passwordHash;

    await sql`
      UPDATE users SET role = ${nextRole}, active = ${nextActive}, driver_vehicle_id = ${nextDriverVehicleId}, password_hash = ${nextPasswordHash}
      WHERE username = ${user.username}
    `;
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
// driver's vehicle plan, same as a normal Assign) or rejects. Lives in
// Postgres's `delivery_bookings` table — needs to be visible to every driver
// and every manager/admin at once, which localStorage (what routePlan/
// batchRoutes use) can never provide across devices.
type BookingStatus = 'pending' | 'confirmed' | 'rejected';

interface BookingRecord {
  id: number;
  orderNo: string;
  driverUsername: string;
  driverVehicleId: string;
  status: BookingStatus;
  bookedAt: string;
  decidedBy: string;
  decidedAt: string;
  note: string;
}

interface BookingPgRow {
  id: number;
  order_uid: string;
  driver_username: string;
  driver_vehicle_id: string;
  status: string;
  booked_at: Date | string;
  decided_by: string;
  decided_at: Date | string | null;
  note: string;
}

function rowToBooking(r: BookingPgRow): BookingRecord {
  const status = r.status;
  return {
    id: r.id,
    orderNo: r.order_uid,
    driverUsername: r.driver_username,
    driverVehicleId: r.driver_vehicle_id,
    status: status === 'confirmed' || status === 'rejected' ? status : 'pending',
    bookedAt: new Date(r.booked_at).toISOString(),
    decidedBy: r.decided_by,
    decidedAt: r.decided_at ? new Date(r.decided_at).toISOString() : '',
    note: r.note,
  };
}

/** Any authenticated user can list bookings — drivers need to see what's
 * already taken before picking, managers/admins need to see the queue of
 * pending requests. Nothing here is more sensitive than what's already on
 * the (also authenticated-only) planner page. */
export async function handleListBookings(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const rows = await getDb()<BookingPgRow[]>`SELECT * FROM delivery_bookings ORDER BY id`;
    const bookings = rows.map(rowToBooking);
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
 * for the same order is resolved as first-write-wins, arbitrated by the
 * auto-increment `id` (Postgres assigns these in insert order, so whichever
 * insert the database processed first gets the lower id) — not by request
 * arrival order at this function, which two concurrent serverless
 * invocations can't otherwise agree on. Whoever's row isn't first for its
 * orderNo gets demoted to 'rejected' immediately and reported back as a
 * conflict, rather than left as a second live booking. */
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
    const sql = getDb();
    const existing = (await sql<BookingPgRow[]>`SELECT * FROM delivery_bookings WHERE status IN ('pending', 'confirmed')`).map(rowToBooking);
    const activeOrderNos = new Set(existing.map((b) => b.orderNo));
    const alreadyTaken = wanted.filter((n) => activeOrderNos.has(n));
    const toCreate = wanted.filter((n) => !activeOrderNos.has(n));

    if (toCreate.length === 0) {
      return { status: 200, body: { created: [], conflicts: alreadyTaken } };
    }

    const bookedAt = new Date().toISOString();
    const insertRows = toCreate.map((orderNo) => [orderNo, payload.username, payload.driverVehicleId!, 'pending', bookedAt]);
    await sql`INSERT INTO delivery_bookings (order_uid, driver_username, driver_vehicle_id, status, booked_at) VALUES ${sql(bulkRows(insertRows))}`;

    // Re-read and resolve: for each order just requested, whichever active
    // row now has the lowest id actually won it.
    const after = (await sql<BookingPgRow[]>`SELECT * FROM delivery_bookings WHERE order_uid = ANY(${toCreate}) AND status IN ('pending', 'confirmed')`).map(rowToBooking);
    const created: string[] = [];
    const conflicts: string[] = [...alreadyTaken];
    for (const orderNo of toCreate) {
      const rowsForOrder = after.filter((b) => b.orderNo === orderNo).sort((a, b) => a.id - b.id);
      const winner = rowsForOrder[0];
      const mine = after.find((b) => b.orderNo === orderNo && b.driverUsername === payload.username && b.status === 'pending' && b.bookedAt === bookedAt);
      if (mine && winner && winner.id === mine.id) {
        created.push(orderNo);
      } else if (mine) {
        await sql`UPDATE delivery_bookings SET status = 'rejected', decided_by = 'system', decided_at = now(), note = 'ชนกับคำขอจองอื่นที่มาถึงก่อน' WHERE id = ${mine.id}`;
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
    const sql = getDb();
    const [row] = await sql<BookingPgRow[]>`SELECT * FROM delivery_bookings WHERE order_uid = ${orderNo.trim()} AND status = 'pending' ORDER BY id LIMIT 1`;
    if (!row) return { status: 404, body: { error: 'ไม่พบคำขอจองที่รอดำเนินการสำหรับออเดอร์นี้ — อาจถูกตัดสินใจไปแล้ว' } };
    const booking = rowToBooking(row);

    const nextStatus = decision === 'confirm' ? 'confirmed' : 'rejected';
    const nextNote = typeof note === 'string' ? note.trim() : '';
    await sql`UPDATE delivery_bookings SET status = ${nextStatus}, decided_by = ${payload.username}, decided_at = now(), note = ${nextNote} WHERE id = ${booking.id}`;
    return { status: 200, body: { ok: true, driverUsername: booking.driverUsername, driverVehicleId: booking.driverVehicleId } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'ยืนยัน/ปฏิเสธคำขอจองคิวไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

// ---------- Batch Routes ----------
// A "Batch Route" is a vehicle's locked delivery run for one day, created by
// the Planner's "Assign" step. Lives in Postgres's `batch_routes` table —
// needed across devices (a driver's phone, the office desktop planning it)
// the same way Bookings does.
//
// orderNos is NOT a stored column (unlike the old Sheets version) — batch
// membership is normalized onto orders.batch_route_id (a foreign key), and
// stop sequence within the batch onto orders.stop_sequence (see
// db/migrations/0002_writeback_support.sql). The one exception: a CANCELLED
// batch's orders get batch_route_id cleared (freeing them for re-planning),
// so its "what did this used to contain" history is preserved separately in
// batch_routes.cancelled_order_uids, snapshotted at the moment of
// cancellation. handleListBatchRoutes reads whichever is appropriate;
// handleUpsertBatchRoutes is what reconciles orders' FK/sequence to match.
interface BatchRouteRecord {
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

interface BatchRoutePgRow {
  id: string;
  vehicle_id: string;
  vehicle_name: string;
  delivery_date: string | null;
  created_at: Date | string | null;
  created_by: string;
  updated_at: Date | string | null;
  updated_by: string;
  locked: boolean;
  cod_closed: boolean;
  cod_closed_at: Date | string | null;
  cod_closed_by: string;
  cancelled: boolean;
  cancelled_at: Date | string | null;
  cancelled_by: string;
  cancelled_order_uids: string[] | null;
  live_order_uids: string[];
}

async function readBatchRoutesRawPg(sql: ReturnType<typeof getDb>): Promise<BatchRoutePgRow[]> {
  return sql<BatchRoutePgRow[]>`
    SELECT
      br.id, br.vehicle_id, br.vehicle_name, br.delivery_date::text AS delivery_date,
      br.created_at, br.created_by, br.updated_at, br.updated_by,
      br.locked, br.cod_closed, br.cod_closed_at, br.cod_closed_by,
      br.cancelled, br.cancelled_at, br.cancelled_by, br.cancelled_order_uids,
      COALESCE(array_agg(o.order_uid ORDER BY o.stop_sequence) FILTER (WHERE o.order_uid IS NOT NULL), '{}') AS live_order_uids
    FROM batch_routes br
    LEFT JOIN orders o ON o.batch_route_id = br.id
    GROUP BY br.id
    ORDER BY br.created_at
  `;
}

function batchRouteRecordFromRow(r: BatchRoutePgRow): BatchRouteRecord {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    vehicleName: r.vehicle_name,
    deliveryDate: r.delivery_date ?? '',
    orderNos: r.cancelled ? (r.cancelled_order_uids ?? []) : r.live_order_uids,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : '',
    createdBy: r.created_by,
    updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : '',
    updatedBy: r.updated_by,
    locked: r.locked,
    codClosed: r.cod_closed,
    codClosedAt: r.cod_closed_at ? new Date(r.cod_closed_at).toISOString() : '',
    codClosedBy: r.cod_closed_by,
    cancelled: r.cancelled,
    cancelledAt: r.cancelled_at ? new Date(r.cancelled_at).toISOString() : '',
    cancelledBy: r.cancelled_by,
  };
}

/** Any authenticated user can list batch routes — same reasoning as
 * Bookings: a driver needs to see their own vehicle's assigned dates, and
 * nothing here is more sensitive than what the desktop Planner already
 * shows to manager/admin_staff. */
export async function handleListBatchRoutes(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const rows = await readBatchRoutesRawPg(getDb());
    return { status: 200, body: { batchRoutes: rows.map(batchRouteRecordFromRow) } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลด Batch Route ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** "Export เป็น Excel" on Batch Route History — one summary row per batch
 * plus a second sheet with one row per order-within-a-batch (the "stops"
 * BatchRouteHistoryPanel expands to show), joined against the same
 * Unii-plus-Postgres order data as handleExportRouteOrders. COD cash figures
 * (expected/collected/diff/transfer) are deliberately left out — that state
 * only ever lived in the browser's local COD-clearing store, never in
 * Postgres, so there's nothing server-side to export for it. */
export async function handleExportBatchRouteHistory(token: string | null): Promise<ApiResult | FileResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };

  const sql = getDb();
  const [uniiResult, staffInfos, batchRawRows] = await Promise.all([
    readCachedApiImportOrders(),
    readStaffOrderInfoPg(sql),
    readBatchRoutesRawPg(sql),
  ]);
  if (uniiResult.orders.length === 0) {
    return { status: 502, body: { error: uniiResult.error ?? 'ยังไม่มีข้อมูลออเดอร์ — export ไม่ได้' } };
  }

  const orderByNo = new Map(joinRouteOrdersForExport(uniiResult.orders, staffInfos).map((o): [string, RouteOrder] => [o.orderNo, o]));
  const batches = batchRawRows.map(batchRouteRecordFromRow);

  // Loaded on demand, not at module top-level: exceljs is only ever needed by
  // the two export routes, out of the ~15 endpoints this file backs. A
  // top-level `import ExcelJS from 'exceljs'` used to pull it into every one
  // of Vercel's 12 serverless functions' module graph (server/lib.ts is the
  // single shared core all of them import from), even the ones that never
  // export anything — this keeps that weight, and any exceljs-specific
  // bundling/runtime quirk, isolated to just these two handlers.
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
  // with a narrower one (see FileResult's comment) — cast through unknown to
  // sidestep that structural mismatch rather than the two never unifying.
  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  return {
    status: 200,
    filename: `batch-route-history-${new Date().toISOString().slice(0, 10)}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  };
}

/** Bulk upsert — the client always sends its whole current batchRoutes list
 * (never large: a handful of vehicles × at most a couple of batches each per
 * day), matched by id; unmatched ids are created.
 *
 * Unlike the old Sheets version, this single call now ALSO reconciles every
 * affected order's batch_route_id/route/assigned_driver/stop_sequence to
 * match each batch's orderNos, transactionally — previously this required a
 * second, entirely separate round trip per order (stampCourierOrders writing
 * "คนส่ง" on the คำสั่งซื้อ VS tab) that could partially fail independently of
 * the batch-route write itself (see the now-removed courierStampWarning on
 * the frontend). Folding both into one Postgres transaction removes that
 * whole class of "batch says X but the order still shows Y" inconsistency.
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

  const incoming: BatchRouteRecord[] = [];
  for (const raw of batchRoutes) {
    const b = (raw ?? {}) as Record<string, unknown>;
    if (typeof b.id !== 'string' || !b.id.trim()) return { status: 400, body: { error: 'batchRoutes ทุกรายการต้องมี id' } };
    incoming.push({
      id: b.id.trim(),
      vehicleId: typeof b.vehicleId === 'string' ? b.vehicleId : '',
      vehicleName: typeof b.vehicleName === 'string' ? b.vehicleName : '',
      deliveryDate: typeof b.deliveryDate === 'string' ? b.deliveryDate : '',
      orderNos: Array.isArray(b.orderNos) ? b.orderNos.filter((n): n is string => typeof n === 'string') : [],
      createdAt: typeof b.createdAt === 'string' && b.createdAt ? b.createdAt : new Date().toISOString(),
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
    const sql = getDb();
    const existingRaw = await readBatchRoutesRawPg(sql);
    const existingRawById = new Map(existingRaw.map((r) => [r.id, r]));
    const existingById = new Map(existingRaw.map((r) => [r.id, batchRouteRecordFromRow(r)]));

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

    const users = await readUsersPg(sql);

    await sql.begin(async (tx) => {
      for (const b of incoming) {
        const curRaw = existingRawById.get(b.id);
        const wasAlreadyCancelled = curRaw?.cancelled ?? false;
        const isNewlyCancelled = b.cancelled && !wasAlreadyCancelled;
        const cancelledSnapshot = isNewlyCancelled ? (curRaw?.live_order_uids ?? b.orderNos) : (curRaw?.cancelled_order_uids ?? null);

        await tx`
          INSERT INTO batch_routes (
            id, vehicle_id, vehicle_name, delivery_date, created_at, created_by, updated_at, updated_by,
            locked, cod_closed, cod_closed_at, cod_closed_by, cancelled, cancelled_at, cancelled_by, cancelled_order_uids
          )
          VALUES (
            ${b.id}, ${b.vehicleId}, ${b.vehicleName}, ${b.deliveryDate || null}, ${b.createdAt || null}, ${b.createdBy},
            ${b.updatedAt}, ${b.updatedBy}, ${b.locked}, ${b.codClosed}, ${b.codClosedAt || null}, ${b.codClosedBy},
            ${b.cancelled}, ${b.cancelledAt || null}, ${b.cancelledBy}, ${cancelledSnapshot}
          )
          ON CONFLICT (id) DO UPDATE SET
            vehicle_id = EXCLUDED.vehicle_id, vehicle_name = EXCLUDED.vehicle_name, delivery_date = EXCLUDED.delivery_date,
            updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by, locked = EXCLUDED.locked,
            cod_closed = EXCLUDED.cod_closed, cod_closed_at = EXCLUDED.cod_closed_at, cod_closed_by = EXCLUDED.cod_closed_by,
            cancelled = EXCLUDED.cancelled, cancelled_at = EXCLUDED.cancelled_at, cancelled_by = EXCLUDED.cancelled_by,
            cancelled_order_uids = EXCLUDED.cancelled_order_uids
        `;

        const previousLiveMembers = curRaw?.live_order_uids ?? [];
        if (b.cancelled) {
          if (previousLiveMembers.length > 0) {
            await tx`
              UPDATE orders SET batch_route_id = NULL, route = '', assigned_driver = '', assigned_at = NULL, stop_sequence = NULL, updated_at = now()
              WHERE batch_route_id = ${b.id}
            `;
          }
        } else {
          const desired = new Set(b.orderNos);
          const toRemove = previousLiveMembers.filter((id) => !desired.has(id));
          if (toRemove.length > 0) {
            await tx`
              UPDATE orders SET batch_route_id = NULL, route = '', assigned_driver = '', assigned_at = NULL, stop_sequence = NULL, updated_at = now()
              WHERE order_uid = ANY(${toRemove}) AND batch_route_id = ${b.id}
            `;
          }
          if (b.orderNos.length > 0) {
            // Driver's own display name is their username, resolved here
            // (never sent from the frontend) — same reasoning the old
            // courier-stamp write used: listing Users is admin/manager-only
            // and admin_staff, who can also run the Planner, has no access
            // to /api/users.
            const driver = users.find((u) => u.active && u.role === 'driver' && u.driverVehicleId === b.vehicleId);
            for (let i = 0; i < b.orderNos.length; i++) {
              // UPSERT, not a plain UPDATE: an order assigned straight into a
              // batch without ever going through handleUpdateRouteOrder first
              // (e.g. a brand-new order nobody has edited note/date on yet)
              // has no `orders` row at all — a plain UPDATE against a
              // nonexistent row silently affects zero rows and still returns
              // { ok: true }, so the FK assignment looked successful but
              // never actually persisted. Found via the Excel export's Batch
              // Route History sheet coming back with an empty order list for
              // every batch.
              await tx`
                INSERT INTO orders (order_uid, batch_route_id, route, assigned_driver, assigned_at, stop_sequence)
                VALUES (${b.orderNos[i]}, ${b.id}, ${b.vehicleName}, ${driver?.username ?? ''}, now(), ${i})
                ON CONFLICT (order_uid) DO UPDATE SET
                  batch_route_id = EXCLUDED.batch_route_id,
                  route = EXCLUDED.route,
                  assigned_driver = EXCLUDED.assigned_driver,
                  assigned_at = COALESCE(orders.assigned_at, EXCLUDED.assigned_at),
                  stop_sequence = EXCLUDED.stop_sequence,
                  updated_at = now()
              `;
            }
          }
        }
      }
    });

    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'บันทึก Batch Route ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** `databaseConfigured` alone (env var present) was never enough to tell
 * apart "DATABASE_URL isn't set" from "it's set but wrong/unreachable/
 * migrations never ran against it" — exactly the ambiguity that made a batch
 * of Postgres-backed endpoints (cs-master, ops/activity-log, ops/receiving,
 * ...) all fail with a bare 500 with no way to see why short of Vercel's own
 * function logs. `databaseConnected`/`databaseError` do a real `SELECT 1`
 * (2s timeout — this must stay fast, /api/health is meant to be cheap) so
 * hitting this one endpoint after a deploy tells the whole story: unset,
 * set-but-unreachable (bad host/credential/network), or set-and-working. */
export async function handleHealth(): Promise<ApiResult> {
  const configured = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  const databaseConfigured = !!process.env.DATABASE_URL?.trim();
  let databaseConnected = false;
  let databaseError: string | null = null;
  if (databaseConfigured) {
    try {
      await Promise.race([getDb()`SELECT 1`, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out after 2s')), 2000))]);
      databaseConnected = true;
    } catch (err: unknown) {
      databaseError = err instanceof Error ? err.message : 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ (ไม่ทราบสาเหตุ)';
    }
  }
  return {
    status: 200,
    body: {
      ok: true,
      serviceAccountConfigured: configured,
      databaseConfigured,
      databaseConnected,
      databaseError,
      uniiApiConfigured: !!process.env.UNII_API_TOKEN?.trim(),
      driveFolderConfigured: !!process.env[DRIVE_ROOT_FOLDER_ENV]?.trim(),
      driveMockMode: !configured || !process.env[DRIVE_ROOT_FOLDER_ENV]?.trim(),
    },
  };
}

/** Customer lat/lng override — see db/README.md's customers table notes.
 * Matched by phone (the table's primary key), not name+phone fuzzy matching
 * like the old Sheets version needed (real sheet rows had no enforced
 * uniqueness at all). A customer never seen before (no row yet — the
 * migration script only captured what existed at the time it ran) gets one
 * created on the spot rather than rejected with 404; this endpoint still
 * only ever touches lat_override/lng_override, same field-level restriction
 * as before — name is accepted only to seed name_from_unii on that first
 * insert, never overwritten on an existing row. */
export async function handleUpdateCsMasterLocation(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!['administrator', 'manager', 'admin_staff', 'driver'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์แก้ไขพิกัดลูกค้า' } };
  }

  const { name, phone, lat, lng } = (body ?? {}) as Record<string, unknown>;

  if (typeof name !== 'string' || name.trim() === '') {
    return { status: 400, body: { error: 'ต้องระบุชื่อลูกค้า' } };
  }
  if (typeof phone !== 'string' || phone.trim() === '') {
    return { status: 400, body: { error: 'ต้องระบุเบอร์โทรลูกค้า' } };
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { status: 400, body: { error: 'lat/lng ต้องเป็นตัวเลข' } };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { status: 400, body: { error: 'lat/lng อยู่นอกช่วงที่เป็นไปได้' } };
  }

  try {
    await getDb()`
      INSERT INTO customers (phone, name_from_unii, lat_override, lng_override)
      VALUES (${phone.trim()}, ${name.trim()}, ${lat}, ${lng})
      ON CONFLICT (phone) DO UPDATE SET lat_override = EXCLUDED.lat_override, lng_override = EXCLUDED.lng_override, updated_at = now()
    `;
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[cs-master/update-location]', message);
    return { status: 500, body: { error: message } };
  }
}

/** Every customer with a saved lat/lng override, keyed by phone — the
 * frontend still reads its base customer list (name/address/etc.) straight
 * from the CS Master Google Sheet, unchanged; this endpoint supplies just
 * the override on top, since that's the one piece this app now writes to
 * Postgres instead (see handleUpdateCsMasterLocation) and Sheets would
 * otherwise never reflect it again. Same "any authenticated user" reasoning
 * as Bookings/Batch Routes — nothing here is more sensitive than the
 * Customer Master page itself. */
export async function handleListCustomerLocationOverrides(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const rows = await getDb()`
      SELECT phone, lat_override, lng_override FROM customers WHERE lat_override IS NOT NULL AND lng_override IS NOT NULL
    `;
    return {
      status: 200,
      body: { overrides: rows.map((r) => ({ phone: r.phone as string, lat: Number(r.lat_override), lng: Number(r.lng_override) })) },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลดพิกัดลูกค้าที่แก้ไขไว้ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** Keeps customers.name_from_unii current as shop names change in Unii —
 * matched by phone (the table's primary key) only, never by name, so a
 * renamed shop updates its existing row in place instead of ever creating a
 * new one. Only touches name_from_unii; lat_override/lng_override and every
 * other saved field for that phone are left completely alone, so a rename
 * never loses a previously-corrected pin. Called by the frontend right after
 * it reads the CS Master sheet (see src/state/store.ts), since that's the
 * one place the app already has fresh name+phone pairs on hand — same
 * "local read triggers a background Postgres sync" shape as the rest of this
 * migration. */
export async function handleSyncCustomerNames(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };

  const { customers } = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(customers)) return { status: 400, body: { error: 'ต้องระบุ customers เป็น array' } };

  const byPhone = new Map<string, string>();
  for (const raw of customers) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const phone = typeof c.phone === 'string' ? c.phone.trim() : '';
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!phone || !name) continue;
    byPhone.set(phone, name); // last one wins if the sheet has a duplicate phone
  }
  if (byPhone.size === 0) return { status: 200, body: { ok: true, synced: 0 } };

  try {
    const sql = getDb();
    const rows = Array.from(byPhone.entries()).map(([phone, name]) => [phone, name]);
    await sql`
      INSERT INTO customers (phone, name_from_unii) VALUES ${sql(bulkRows(rows))}
      ON CONFLICT (phone) DO UPDATE SET name_from_unii = EXCLUDED.name_from_unii, updated_at = now()
      WHERE customers.name_from_unii IS DISTINCT FROM EXCLUDED.name_from_unii
    `;
    return { status: 200, body: { ok: true, synced: byPhone.size } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'ซิงค์ชื่อลูกค้าไม่สำเร็จ';
    console.error('[cs-master/sync-names]', message);
    return { status: 500, body: { error: message } };
  }
}

/** Upserts customers.{name_from_unii,lat_from_unii,lng_from_unii,
 * address_from_unii} by phone from a batch of orders fresh off the Unii API
 * — called only from handleSyncUniiOrders, right after a successful live
 * Unii fetch. Deliberately leaves lat_override/lng_override untouched, same
 * as handleSyncCustomerNames — a manually corrected pin always wins over
 * whatever Unii itself reports. Orders come back sorted createdAt:desc, so
 * the FIRST order seen for a phone is the most recent one — that's the
 * customer snapshot that should win if the same phone appears on more than
 * one order in this batch. */
async function syncCustomersFromApiImportOrders(orders: ApiImportOrder[]): Promise<void> {
  const byPhone = new Map<string, { name: string; lat: number | null; lng: number | null; address: string }>();
  for (const o of orders) {
    const phone = o.phone.trim();
    if (!phone || byPhone.has(phone)) continue;
    byPhone.set(phone, { name: o.customer.trim(), lat: o.lat, lng: o.lng, address: o.address.trim() });
  }
  if (byPhone.size === 0) return;

  const sql = getDb();
  const rows = Array.from(byPhone.entries()).map(([phone, c]) => [phone, c.name, c.lat, c.lng, c.address]);
  await sql`
    INSERT INTO customers (phone, name_from_unii, lat_from_unii, lng_from_unii, address_from_unii)
    VALUES ${sql(bulkRows(rows))}
    ON CONFLICT (phone) DO UPDATE SET
      name_from_unii = EXCLUDED.name_from_unii,
      lat_from_unii = EXCLUDED.lat_from_unii,
      lng_from_unii = EXCLUDED.lng_from_unii,
      address_from_unii = EXCLUDED.address_from_unii,
      updated_at = now()
  `;
}

const UNII_ORDER_CACHE_COLUMNS = [
  'order_uid',
  'no',
  'status',
  'payment_type',
  'paid',
  'item_count',
  'total_amount',
  'customer',
  'phone',
  'address',
  'district',
  'province',
  'ordered_at',
  'delivered_at',
  'completed_at',
  'wants_tax_invoice',
  'unii_updated_at',
  'lat',
  'lng',
  'distance_from_wh_km',
  'wh_lat',
  'wh_lng',
  'raw',
] as const;

// Comfortably under postgres.js's ~65534-parameter-per-query ceiling (22
// columns * 500 rows = 11,000 params) — chunked so a branch with an
// unusually large order history can never hit that limit in one INSERT.
const UPSERT_CHUNK_SIZE = 500;

/** Upserts every order into unii_order_cache, keyed by order_uid — never
 * deletes anything (see db/migrations/0003_unii_order_cache.sql's header
 * comment for why: a sync that stops early on Unii's pagination time budget
 * must never be read as "these orders don't exist anymore"). Chunked to
 * stay well under postgres.js's per-query parameter limit regardless of how
 * many orders one sync fetches. */
async function upsertUniiOrderCache(sql: ReturnType<typeof getDb>, orders: ApiImportOrder[]): Promise<void> {
  if (orders.length === 0) return;
  const rows = orders.map((o) => ({
    order_uid: o.orderUid,
    no: o.no,
    status: o.status,
    payment_type: o.paymentType,
    paid: o.paid,
    item_count: o.itemCount,
    total_amount: o.totalAmount,
    customer: o.customer,
    phone: o.phone,
    address: o.address,
    district: o.district,
    province: o.province,
    ordered_at: o.orderedAt,
    delivered_at: o.deliveredAt,
    completed_at: o.completedAt,
    wants_tax_invoice: o.wantsTaxInvoice,
    unii_updated_at: o.updatedAt,
    lat: o.lat,
    lng: o.lng,
    distance_from_wh_km: o.distanceFromWhKm,
    wh_lat: o.whLat,
    wh_lng: o.whLng,
    // o.raw is Unii's own parsed JSON response body (server/unii.ts's
    // mapUniiOrder), so it's always plain-JSON-serializable at runtime —
    // postgres.js's JSONValue type just doesn't structurally match a
    // Record<string, unknown> index signature.
    raw: sql.json(o.raw as Parameters<typeof sql.json>[0]),
  }));

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK_SIZE);
    await sql`
      INSERT INTO unii_order_cache ${sql(chunk, ...UNII_ORDER_CACHE_COLUMNS)}
      ON CONFLICT (order_uid) DO UPDATE SET
        no = EXCLUDED.no,
        status = EXCLUDED.status,
        payment_type = EXCLUDED.payment_type,
        paid = EXCLUDED.paid,
        item_count = EXCLUDED.item_count,
        total_amount = EXCLUDED.total_amount,
        customer = EXCLUDED.customer,
        phone = EXCLUDED.phone,
        address = EXCLUDED.address,
        district = EXCLUDED.district,
        province = EXCLUDED.province,
        ordered_at = EXCLUDED.ordered_at,
        delivered_at = EXCLUDED.delivered_at,
        completed_at = EXCLUDED.completed_at,
        wants_tax_invoice = EXCLUDED.wants_tax_invoice,
        unii_updated_at = EXCLUDED.unii_updated_at,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        distance_from_wh_km = EXCLUDED.distance_from_wh_km,
        wh_lat = EXCLUDED.wh_lat,
        wh_lng = EXCLUDED.wh_lng,
        raw = EXCLUDED.raw,
        synced_at = now()
    `;
  }
}

interface UniiOrderCacheRow {
  order_uid: string;
  no: string;
  status: string;
  payment_type: string;
  paid: string;
  item_count: number;
  total_amount: string | number;
  customer: string;
  phone: string;
  address: string;
  district: string;
  province: string;
  ordered_at: string;
  delivered_at: string;
  completed_at: string;
  wants_tax_invoice: string;
  unii_updated_at: string;
  lat: string | number | null;
  lng: string | number | null;
  distance_from_wh_km: string | number | null;
  wh_lat: string | number | null;
  wh_lng: string | number | null;
  raw: Record<string, unknown> | null;
}

function numOrNull(v: string | number | null): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The one read path every consumer of Unii order data now goes through —
 * Dashboard, Order Management, Planner, exports, all of it — instead of each
 * calling Unii live. `stale`/`error` reflect unii_sync_status.last_error:
 * true only when the MOST RECENT sync attempt failed, cleared back to false
 * the moment a later sync succeeds, so a since-resolved failure never lingers
 * as a false alarm. Never throws and never 502s except when the cache is
 * still completely empty (a brand-new database whose first sync hasn't run
 * yet) — any other case, however stale, still has real data worth showing. */
async function readCachedApiImportOrders(): Promise<{ orders: ApiImportOrder[]; stale: boolean; error: string | null }> {
  const sql = getDb();
  const [rows, statusRows] = await Promise.all([
    sql<UniiOrderCacheRow[]>`SELECT * FROM unii_order_cache ORDER BY synced_at DESC`,
    sql<{ last_error: string | null }[]>`SELECT last_error FROM unii_sync_status WHERE id = 'singleton'`,
  ]);

  const orders: ApiImportOrder[] = rows.map((r) => ({
    no: r.no,
    orderUid: r.order_uid,
    status: r.status,
    paymentType: r.payment_type,
    paid: r.paid,
    itemCount: Number(r.item_count),
    totalAmount: Number(r.total_amount),
    customer: r.customer,
    phone: r.phone,
    address: r.address,
    district: r.district,
    province: r.province,
    orderedAt: r.ordered_at,
    deliveredAt: r.delivered_at,
    completedAt: r.completed_at,
    wantsTaxInvoice: r.wants_tax_invoice,
    updatedAt: r.unii_updated_at,
    lat: numOrNull(r.lat),
    lng: numOrNull(r.lng),
    distanceFromWhKm: numOrNull(r.distance_from_wh_km),
    whLat: numOrNull(r.wh_lat),
    whLng: numOrNull(r.wh_lng),
    raw: r.raw ?? {},
  }));

  const lastError = statusRows[0]?.last_error ?? null;
  return { orders, stale: !!lastError, error: lastError };
}

/** Order data from the persisted Unii mirror (see readCachedApiImportOrders)
 * — replaces the old direct-per-request Unii call and, before that, the old
 * public "API Import" Sheets CSV export. Session-gated like every other
 * Postgres-backed read now (Unii has no public/anonymous read path either).
 * Only returns non-2xx when unii_order_cache is still completely empty (no
 * sync has ever succeeded) — a failed sync on top of previously-good data
 * still returns 200 with stale:true, so the frontend keeps showing
 * last-known-good orders instead of an error screen. */
export async function handleFetchApiImportOrders(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };

  const result = await readCachedApiImportOrders();
  if (result.orders.length === 0) {
    return { status: 502, body: { error: result.error ?? 'ยังไม่มีข้อมูลออเดอร์ — รอรอบ sync ถัดไป หรือสั่ง sync ด้วยตนเองก่อน', orders: [] } };
  }

  return { status: 200, body: { orders: result.orders, stale: result.stale, error: result.error } };
}

/** Cron-triggered refresh of unii_order_cache (see vercel.json) — the only
 * thing that ever calls Unii live now (see server/unii.ts's header comment).
 * Vercel automatically attaches `Authorization: Bearer $CRON_SECRET` to its
 * own cron requests once CRON_SECRET is set as a project env var; checked
 * here so this endpoint can't be triggered by anyone who merely guesses its
 * path. A signed-in administrator/manager session also authorizes a call,
 * so a sync can be kicked off manually (e.g. while testing, or from a future
 * "sync now" button) without needing the cron secret on hand. Never lets a
 * Unii-side failure take down anything else: the failure is recorded on
 * unii_sync_status and returned here, but every existing row in
 * unii_order_cache is untouched, so every page read keeps working off
 * whatever was last synced successfully. */
export async function handleSyncUniiOrders(token: string | null): Promise<ApiResult> {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const isCron = !!cronSecret && token === cronSecret;
  const session = isCron ? null : verifySessionToken(token);
  const isPrivilegedUser = !!session && (session.role === 'administrator' || session.role === 'manager');
  if (!isCron && !isPrivilegedUser) {
    return { status: 401, body: { error: 'ต้องใช้ CRON_SECRET หรือ session ของ administrator/manager' } };
  }

  const sql = getDb();
  await sql`
    INSERT INTO unii_sync_status (id, last_attempt_at) VALUES ('singleton', now())
    ON CONFLICT (id) DO UPDATE SET last_attempt_at = now()
  `;

  try {
    const orders = await fetchAllUniiOrders();
    await upsertUniiOrderCache(sql, orders);
    syncCustomersFromApiImportOrders(orders).catch((err: unknown) => {
      console.error('[unii-sync/sync-customers]', err instanceof Error ? err.message : err);
    });
    await sql`
      UPDATE unii_sync_status SET last_success_at = now(), last_error = NULL, row_count = ${orders.length} WHERE id = 'singleton'
    `;
    return { status: 200, body: { ok: true, synced: orders.length } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'ซิงค์ข้อมูล Unii ไม่สำเร็จ';
    console.error('[unii-sync]', message);
    await sql`UPDATE unii_sync_status SET last_error = ${message} WHERE id = 'singleton'`;
    return { status: 502, body: { error: message } };
  }
}

/** Every staff-entered order field — delivery date/note/tax invoice/
 * operational status/archived/courier assignment — read from Postgres's
 * `orders` table instead of the old "คำสั่งซื้อ VS" Sheets tab. Shaped
 * exactly like the old StaffOrderInfo the frontend already knows how to
 * join against ApiImportOrder (still read live from the "API Import" Sheet,
 * unchanged this round — see db/README.md), so joinRouteOrders itself needs
 * no changes at all, only what it's fed. courierStamp is composed from the
 * normalized route/assigned_driver/batch_route_id columns to match the old
 * "{driver} / {vehicle} / {batchId}" text shape exactly, for the same
 * reason. Any authenticated user may read this — same as Bookings/Batch
 * Routes, nothing here is more sensitive than what Order Management already
 * shows everyone who can reach it. */
async function readStaffOrderInfoPg(sql: ReturnType<typeof getDb>): Promise<StaffOrderInfo[]> {
  const rows = await sql`
    SELECT
      order_uid, delivery_date::text AS delivery_date, note, needs_tax_invoice,
      delivery_issue, delivery_issue_at, archived, route, assigned_driver, batch_route_id
    FROM orders
  `;
  return rows.map((r) => ({
    orderUid: r.order_uid as string,
    plannedDeliveryDate: (r.delivery_date as string | null) ?? '',
    note: r.note as string,
    taxInvoiceOverride: r.needs_tax_invoice as boolean | null,
    operationalStatus: r.delivery_issue as string,
    operationalStatusAt: r.delivery_issue_at ? new Date(r.delivery_issue_at as string).toISOString() : '',
    courierStamp: r.batch_route_id ? `${r.assigned_driver} / ${r.route} / ${r.batch_route_id}` : '',
    archived: r.archived as boolean,
    newCustomer: '', // staff never had an edit control for this free-text sheet column — dropped, see db/README.md
  }));
}

export async function handleListRouteOrders(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const orders = await readStaffOrderInfoPg(getDb());
    return { status: 200, body: { orders } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลดข้อมูลออเดอร์ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** Same field-for-field join as src/data/sources/routeOrders.ts's
 * joinRouteOrders — deliberately re-implemented here rather than imported.
 * Importing that module directly would pull its own imports (fetchApiImport
 * Orders/fetchStaffOrderInfo, which reference the DOM-lib fetch/Response
 * types) into this file's Node-only TypeScript program (tsconfig.node.json,
 * no "dom" lib) — that combination genuinely produces conflicting global
 * ArrayBufferLike/Buffer types between @types/node's own fetch typings and
 * lib.dom.d.ts's, breaking exceljs's Buffer-returning APIs elsewhere in this
 * file. Keeping the export path's join logic server-owned avoids ever
 * crossing that boundary; if joinRouteOrders' behavior ever changes, this
 * copy needs the same change made twice. */
function joinRouteOrdersForExport(apiImportOrders: ApiImportOrder[], staffInfos: StaffOrderInfo[]): RouteOrder[] {
  const staffByUid = new Map(staffInfos.map((s) => [s.orderUid, s]));
  return apiImportOrders.map((o): RouteOrder => {
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
      wantsTaxInvoice: staff?.taxInvoiceOverride ?? /^(ใช่|yes|true|y)$/i.test(o.wantsTaxInvoice.trim()),
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
    };
  });
}

/** "Export เป็น Excel" on Order Management — same Unii-plus-Postgres join
 * every page reads (joinRouteOrdersForExport, above), written out as a
 * .xlsx instead of rendered as a table. A couple of on-screen columns are
 * deliberately left out because they only exist as client-side computed
 * state with no server-side equivalent: the route/zone label (from local
 * zoneRules + geocode matching), promo-line badges (from a live SKU Detail
 * read), and delivery-failure photo counts (from the browser's local photo
 * queue). Everything that actually lives in Postgres or comes straight off
 * Unii is included. */
export async function handleExportRouteOrders(token: string | null): Promise<ApiResult | FileResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };

  const [uniiResult, staffInfos] = await Promise.all([readCachedApiImportOrders(), readStaffOrderInfoPg(getDb())]);
  if (uniiResult.orders.length === 0) {
    return { status: 502, body: { error: uniiResult.error ?? 'ยังไม่มีข้อมูลออเดอร์ — export ไม่ได้' } };
  }

  const rows = joinRouteOrdersForExport(uniiResult.orders, staffInfos);

  // See handleExportBatchRouteHistory's identical comment — loaded on demand
  // so exceljs never enters the other ~13 endpoints' module graph.
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
    { header: 'วันที่จัดส่ง (Unii)', key: 'deliveredDate', width: 20 },
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
  // with a narrower one (see FileResult's comment) — cast through unknown to
  // sidestep that structural mismatch rather than the two never unifying.
  const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  return {
    status: 200,
    filename: `orders-${new Date().toISOString().slice(0, 10)}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  };
}

/**
 * Create-or-update one order's staff-entered fields in Postgres, matched by
 * Order UID — an existing row gets its changed fields updated in place; a
 * brand new order (no row yet — this table is populated lazily, only once
 * staff actually enter something for it, same as the old "คำสั่งซื้อ VS" tab
 * was) gets one created. Courier/batch assignment is no longer set through
 * this endpoint — see handleUpsertBatchRoutes, which now reconciles it
 * transactionally alongside the batch route itself.
 */
export async function handleUpdateRouteOrder(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };

  const { orderNo, plannedDeliveryDate, note, wantsTaxInvoice, markDelivered, status, archived } = (body ?? {}) as Record<string, unknown>;

  if (typeof orderNo !== 'string' || orderNo.trim() === '') {
    return { status: 400, body: { error: 'ต้องระบุ Order UID' } };
  }
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
  if (plannedDeliveryDate === undefined && note === undefined && wantsTaxInvoice === undefined && markDelivered === undefined && status === undefined && archived === undefined) {
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

  let nextStatus: string | undefined;
  let nextStatusAt: string | undefined;
  if (markDelivered === true) {
    nextStatus = DELIVERED_STATUS_VALUE;
    nextStatusAt = new Date().toISOString();
  } else if (typeof status === 'string') {
    nextStatus = status;
    nextStatusAt = new Date().toISOString();
  }

  try {
    const sql = getDb();
    const wanted = orderNo.trim();
    // note/delivery_issue/archived are NOT NULL columns with their own
    // defaults, so a plain COALESCE(EXCLUDED.x, orders.x) — which relies on
    // "not provided" meaning SQL NULL — doesn't work for them; each needs an
    // explicit "keep the existing value" fragment on the UPDATE side instead.
    // delivery_date/needs_tax_invoice/delivery_issue_at are nullable, where
    // COALESCE against the old row works directly.
    const noteSet = typeof note === 'string' ? sql`${note}` : sql`orders.note`;
    const archivedSet = typeof archived === 'boolean' ? sql`${archived}` : sql`orders.archived`;
    const statusSet = nextStatus !== undefined ? sql`${nextStatus}` : sql`orders.delivery_issue`;

    await sql`
      INSERT INTO orders (order_uid, delivery_date, note, needs_tax_invoice, delivery_issue, delivery_issue_at, archived)
      VALUES (
        ${wanted}, ${typeof plannedDeliveryDate === 'string' ? plannedDeliveryDate : null}, ${typeof note === 'string' ? note : ''},
        ${typeof wantsTaxInvoice === 'boolean' ? wantsTaxInvoice : null}, ${nextStatus ?? ''}, ${nextStatusAt ?? null},
        ${typeof archived === 'boolean' ? archived : false}
      )
      ON CONFLICT (order_uid) DO UPDATE SET
        delivery_date = COALESCE(EXCLUDED.delivery_date, orders.delivery_date),
        note = ${noteSet},
        needs_tax_invoice = COALESCE(EXCLUDED.needs_tax_invoice, orders.needs_tax_invoice),
        delivery_issue = ${statusSet},
        delivery_issue_at = COALESCE(EXCLUDED.delivery_issue_at, orders.delivery_issue_at),
        archived = ${archivedSet},
        updated_at = now()
    `;
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[route-orders/update]', message);
    return { status: 500, body: { error: message } };
  }
}

/** Every promotion, read from Postgres instead of the old public "โปรโมชั่น"
 * CSV export — shaped as the exact same column-name keys
 * (src/data/sources/promotionsSheet.ts's rowToPromo reads `row['SKU']`,
 * `row['Promotion Term']`, etc.) so that parsing logic needs no changes at
 * all, only what feeds it. Any authenticated user may read this — same
 * reasoning as every other list endpoint here. */
export async function handleListPromotions(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const rows = await getDb()`
      SELECT sku, product_name, status, term_text, start_date::text AS start_date, end_date::text AS end_date,
        period_days, promotion_price, box_price, single_price
      FROM promotions ORDER BY sku
    `;
    return {
      status: 200,
      body: {
        promotions: rows.map((r) => ({
          SKU: r.sku,
          Status: r.status,
          'Product Name': r.product_name,
          'Promotion Term': r.term_text,
          เริ่มโปร: r.start_date ?? '',
          สินสุด: r.end_date ?? '',
          'Promotion Price': r.promotion_price !== null ? String(r.promotion_price) : '',
          'Box Price': r.box_price !== null ? String(r.box_price) : '',
          'Single Price': r.single_price !== null ? String(r.single_price) : '',
        })),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลดโปรโมชั่นไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/**
 * Create-or-update a promotion row in Postgres's `promotions` table, matched
 * by SKU (its primary key) — an existing SKU updates in place; a new one is
 * inserted. Postgres DATE columns take ISO YYYY-MM-DD directly, so (unlike
 * the old Sheets version) start/end need no format conversion — only
 * period_days is still derived. The frontend is responsible for turning
 * whatever pricing shape the user entered (stepped tiers or per-packaging-
 * unit prices) into the plain termText + numeric columns this handler
 * writes — this endpoint doesn't need to know which shape it was.
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

  const periodDays = typeof start === 'string' && start && typeof end === 'string' && end ? daysBetweenIso(start, end) : null;
  const wanted = sku.trim();

  try {
    const sql = getDb();
    const [existing] = await sql`SELECT id FROM promotions WHERE id = ${wanted}`;
    await sql`
      INSERT INTO promotions (id, sku, product_name, status, term_text, start_date, end_date, period_days, promotion_price, box_price, single_price)
      VALUES (
        ${wanted}, ${wanted}, ${productName.trim()}, 'Active', ${termText.trim()},
        ${typeof start === 'string' && start ? start : null}, ${typeof end === 'string' && end ? end : null}, ${periodDays},
        ${typeof promotionPrice === 'number' ? promotionPrice : null}, ${typeof boxPrice === 'number' ? boxPrice : null},
        ${typeof singlePrice === 'number' ? singlePrice : null}
      )
      ON CONFLICT (id) DO UPDATE SET
        product_name = EXCLUDED.product_name, status = EXCLUDED.status, term_text = EXCLUDED.term_text,
        start_date = COALESCE(EXCLUDED.start_date, promotions.start_date), end_date = COALESCE(EXCLUDED.end_date, promotions.end_date),
        period_days = COALESCE(EXCLUDED.period_days, promotions.period_days),
        promotion_price = COALESCE(EXCLUDED.promotion_price, promotions.promotion_price),
        box_price = COALESCE(EXCLUDED.box_price, promotions.box_price),
        single_price = COALESCE(EXCLUDED.single_price, promotions.single_price),
        updated_at = now()
    `;
    return { status: 200, body: { ok: true, created: !existing } };
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

// ---------- Activity Log ----------
// User-action audit trail — was browser localStorage only (src/data/
// activityLog.ts), never sent to any backend at all; now lives in
// Postgres's `activity_log` table so it's shared across every device/
// session instead of scattered per-browser. `actor` is always resolved from
// the session token, never trusted from the request body, so a log entry
// can never be forged as someone else's action.
export async function handleListActivityLog(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    const rows = await getDb()`SELECT id, at, actor, action, detail, order_uid FROM activity_log ORDER BY at DESC LIMIT 500`;
    return {
      status: 200,
      body: {
        entries: rows.map((r) => ({
          id: String(r.id),
          at: new Date(r.at as string).getTime(),
          user: r.actor as string,
          action: r.action as string,
          detail: r.detail as string,
          orderNo: (r.order_uid as string | null) || undefined,
        })),
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลด Activity Log ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

export async function handleAppendActivityLog(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };

  const { action, detail, orderNo } = (body ?? {}) as Record<string, unknown>;
  if (typeof action !== 'string' || !action.trim()) return { status: 400, body: { error: 'ต้องระบุ action' } };
  if (typeof detail !== 'string') return { status: 400, body: { error: 'detail ต้องเป็นข้อความ' } };
  if (orderNo !== undefined && typeof orderNo !== 'string') return { status: 400, body: { error: 'orderNo ต้องเป็นข้อความ' } };

  try {
    const [row] = await getDb()`
      INSERT INTO activity_log (actor, action, detail, order_uid)
      VALUES (${payload.username}, ${action.trim()}, ${detail}, ${typeof orderNo === 'string' ? orderNo : null})
      RETURNING id, at
    `;
    return { status: 200, body: { ok: true, id: String(row.id), at: new Date(row.at as string).getTime() } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'บันทึก Activity Log ไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

// ---------- Batch Picking ----------
// A "pick lot" merges SKU Detail line items across a set of selected orders
// into one shared checklist. Was browser localStorage only (src/data/
// pickLots.ts); now lives in Postgres so an in-progress lot survives a
// reload AND is visible to every picker/checker, not just whoever's browser
// created it. The lines/quantities/customer summaries themselves are NOT
// stored here — those are still derived client-side from live SKU Detail
// reads (src/data/sources/skuDetail.ts, unchanged, out of scope this round;
// see db/README.md) — only lot identity, order membership, and the actual
// picked/closed state (which have no other source) are persisted.
interface PickLotPg {
  id: string;
  createdAt: string;
  orderNos: string[];
  ordersWithNoLines: string[];
  statusSyncPending: string[];
  picked: Record<string, boolean>;
  closed: boolean;
  closedBy: string;
}

async function readPickLotsPg(sql: ReturnType<typeof getDb>): Promise<PickLotPg[]> {
  const [lots, orders, picks] = await Promise.all([
    sql`SELECT id, created_at, closed, closed_by FROM batch_picking ORDER BY created_at DESC`,
    sql`SELECT lot_id, order_uid, has_no_lines, status_sync_pending FROM batch_picking_orders`,
    sql`SELECT lot_id, sku, picked FROM batch_picking_picks`,
  ]);
  return lots.map((l) => {
    const myOrders = orders.filter((o) => o.lot_id === l.id);
    const myPicks = picks.filter((p) => p.lot_id === l.id);
    return {
      id: l.id as string,
      createdAt: new Date(l.created_at as string).toISOString(),
      orderNos: myOrders.map((o) => o.order_uid as string),
      ordersWithNoLines: myOrders.filter((o) => o.has_no_lines).map((o) => o.order_uid as string),
      statusSyncPending: myOrders.filter((o) => o.status_sync_pending).map((o) => o.order_uid as string),
      picked: Object.fromEntries(myPicks.map((p) => [p.sku as string, p.picked as boolean])),
      closed: l.closed as boolean,
      closedBy: l.closed_by as string,
    };
  });
}

/** Any authenticated user can list pick lots — pickers/checkers need to see
 * an in-progress lot from any device, and nothing here is more sensitive
 * than the Pick page itself. */
export async function handleListPickLots(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  try {
    return { status: 200, body: { pickLots: await readPickLotsPg(getDb()) } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลดล็อตหยิบสินค้าไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** Upserts a whole lot's current state — called on create, on every picked-
 * checkbox toggle, and on close (mirrors savePickLots' "save the whole lot
 * object" shape, just against Postgres instead of localStorage). Order
 * membership and the picked map are fully replaced each call (delete then
 * reinsert, in one transaction) rather than diffed — lot sizes are small
 * (one delivery run's worth of orders/SKUs), so this stays simple and never
 * leaves stale rows behind. administrator/manager/picker may create/toggle
 * (canPickWork); the transition from open to closed additionally requires
 * administrator/manager/checker (canClosePickLot) — mirrors the frontend's
 * own two-tier permission exactly. */
export async function handleSavePickLot(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!['administrator', 'manager', 'picker', 'checker'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์จัดการล็อตหยิบสินค้า' } };
  }

  const { id, orderNos, ordersWithNoLines, picked, closed, closedBy, statusSyncPending } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== 'string' || !id.trim()) return { status: 400, body: { error: 'ต้องระบุ id' } };
  if (!Array.isArray(orderNos) || orderNos.some((n) => typeof n !== 'string')) {
    return { status: 400, body: { error: 'orderNos ต้องเป็น array ของข้อความ' } };
  }
  const wantedOrderNos = orderNos as string[];
  const noLinesSet = new Set(Array.isArray(ordersWithNoLines) ? ordersWithNoLines.filter((n): n is string => typeof n === 'string') : []);
  const pendingSet = new Set(Array.isArray(statusSyncPending) ? statusSyncPending.filter((n): n is string => typeof n === 'string') : []);
  const pickedEntries = picked && typeof picked === 'object' ? Object.entries(picked as Record<string, unknown>).filter((e): e is [string, boolean] => typeof e[1] === 'boolean') : [];
  const nextClosed = closed === true;
  const nextClosedBy = typeof closedBy === 'string' ? closedBy : '';
  const lotId = id.trim();

  try {
    const sql = getDb();
    const [existing] = await sql`SELECT closed FROM batch_picking WHERE id = ${lotId}`;
    const isClosingNow = nextClosed && !(existing?.closed ?? false);
    if (isClosingNow && !['administrator', 'manager', 'checker'].includes(payload.role)) {
      return { status: 403, body: { error: 'ไม่มีสิทธิ์ปิดล็อตหยิบสินค้า' } };
    }

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO batch_picking (id, closed, closed_by, closed_at)
        VALUES (${lotId}, ${nextClosed}, ${nextClosedBy}, ${nextClosed ? new Date().toISOString() : null})
        ON CONFLICT (id) DO UPDATE SET
          closed = EXCLUDED.closed, closed_by = EXCLUDED.closed_by,
          closed_at = CASE WHEN EXCLUDED.closed AND NOT batch_picking.closed THEN now() ELSE batch_picking.closed_at END
      `;
      await tx`DELETE FROM batch_picking_orders WHERE lot_id = ${lotId}`;
      if (wantedOrderNos.length > 0) {
        const rows = wantedOrderNos.map((no) => [lotId, no, noLinesSet.has(no), pendingSet.has(no)]);
        await tx`INSERT INTO batch_picking_orders (lot_id, order_uid, has_no_lines, status_sync_pending) VALUES ${tx(bulkRows(rows))}`;
      }
      await tx`DELETE FROM batch_picking_picks WHERE lot_id = ${lotId}`;
      if (pickedEntries.length > 0) {
        const rows = pickedEntries.map(([sku, v]) => [lotId, sku, v]);
        await tx`INSERT INTO batch_picking_picks (lot_id, sku, picked) VALUES ${tx(bulkRows(rows))}`;
      }
    });
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'บันทึกล็อตหยิบสินค้าไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

/** "ยกเลิกล็อตหยิบสินค้า" — only for a lot that never closed (an unclosed lot
 * never wrote any order status, so there's nothing to undo — same guard the
 * frontend already checks before offering the button). Hard-deletes the lot
 * (cascades to its order-membership and picked rows) rather than marking it
 * cancelled, matching the frontend's own cancelPickLot, which simply drops
 * the lot from its list — an unclosed lot was never part of any history
 * worth preserving. */
export async function handleCancelPickLot(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!['administrator', 'manager', 'admin_staff'].includes(payload.role)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์ยกเลิกล็อตหยิบสินค้า' } };
  }
  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== 'string' || !id.trim()) return { status: 400, body: { error: 'ต้องระบุ id' } };

  try {
    const sql = getDb();
    const [existing] = await sql`SELECT closed FROM batch_picking WHERE id = ${id.trim()}`;
    if (!existing) return { status: 404, body: { error: 'ไม่พบล็อตหยิบสินค้านี้' } };
    if (existing.closed) return { status: 409, body: { error: 'ล็อตนี้ปิดแล้ว ยกเลิกไม่ได้' } };
    await sql`DELETE FROM batch_picking WHERE id = ${id.trim()}`;
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'ยกเลิกล็อตหยิบสินค้าไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

// ---------- Goods Receiving ----------
// Was browser localStorage only (src/data/receiving.ts) — no backend ever
// existed for it. Now lives in Postgres's `goods_receiving` (one row per
// receiving event) + `goods_receiving_lines` (its SKU line items) tables.
// Same role set as the "grn" page's own 'edit' access (administrator/
// manager/admin_staff/checker — see src/config/permissions.ts).
const GRN_ROLES = ['administrator', 'manager', 'admin_staff', 'checker'];

interface ReceivingLinePg {
  id: string;
  skuId: string;
  uniiName: string;
  billName: string;
  billBarcode: string;
  unit: string;
  billQty: number;
  actualQty: number;
  unitPrice: number;
  discount: number;
  discountMode: 'baht' | 'percent';
  type: string;
  note: string;
}
interface ReceivingRecordPg {
  id: string;
  supplier: string;
  billNo: string;
  receivedDate: string;
  recordedBy: string;
  note: string;
  createdAt: string;
  lines: ReceivingLinePg[];
}

async function readReceivingPg(sql: ReturnType<typeof getDb>): Promise<ReceivingRecordPg[]> {
  const [records, lines] = await Promise.all([
    sql`SELECT id, supplier, bill_no, received_date::text AS received_date, recorded_by, note, created_at FROM goods_receiving ORDER BY created_at DESC`,
    sql`SELECT id, receiving_id, sku_id, unii_name, bill_name, bill_barcode, unit, bill_qty, actual_qty, unit_price, discount, discount_mode, line_type, note FROM goods_receiving_lines`,
  ]);
  return records.map((r) => ({
    id: r.id as string,
    supplier: r.supplier as string,
    billNo: r.bill_no as string,
    receivedDate: (r.received_date as string | null) ?? '',
    recordedBy: r.recorded_by as string,
    note: r.note as string,
    createdAt: new Date(r.created_at as string).toISOString(),
    lines: lines
      .filter((l) => l.receiving_id === r.id)
      .map((l) => ({
        id: String(l.id),
        skuId: l.sku_id as string,
        uniiName: l.unii_name as string,
        billName: l.bill_name as string,
        billBarcode: l.bill_barcode as string,
        unit: l.unit as string,
        billQty: Number(l.bill_qty),
        actualQty: Number(l.actual_qty),
        unitPrice: Number(l.unit_price),
        discount: Number(l.discount),
        discountMode: l.discount_mode as 'baht' | 'percent',
        type: l.line_type as string,
        note: l.note as string,
      })),
  }));
}

export async function handleListReceiving(token: string | null): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!GRN_ROLES.includes(payload.role)) return { status: 403, body: { error: 'ไม่มีสิทธิ์เข้าถึงข้อมูลรับสินค้าเข้าคลัง' } };
  try {
    return { status: 200, body: { receiving: await readReceivingPg(getDb()) } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'โหลดข้อมูลรับสินค้าเข้าคลังไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

export async function handleCreateReceiving(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!GRN_ROLES.includes(payload.role)) return { status: 403, body: { error: 'ไม่มีสิทธิ์บันทึกรับสินค้าเข้าคลัง' } };

  const { id, supplier, billNo, receivedDate, note, lines } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== 'string' || !id.trim()) return { status: 400, body: { error: 'ต้องระบุ id' } };
  if (typeof supplier !== 'string' || !supplier.trim()) return { status: 400, body: { error: 'ต้องระบุซัพพลายเออร์' } };
  if (typeof billNo !== 'string' || !billNo.trim()) return { status: 400, body: { error: 'ต้องระบุเลขบิล' } };
  if (receivedDate !== undefined && typeof receivedDate !== 'string') return { status: 400, body: { error: 'receivedDate ต้องเป็นข้อความรูปแบบ YYYY-MM-DD' } };
  if (!Array.isArray(lines)) return { status: 400, body: { error: 'lines ต้องเป็น array' } };

  const parsedLines: unknown[][] = [];
  for (const raw of lines) {
    const l = (raw ?? {}) as Record<string, unknown>;
    if (typeof l.skuId !== 'string') return { status: 400, body: { error: 'แต่ละรายการต้องมี skuId' } };
    parsedLines.push([
      id.trim(),
      l.skuId,
      typeof l.uniiName === 'string' ? l.uniiName : '',
      typeof l.billName === 'string' ? l.billName : '',
      typeof l.billBarcode === 'string' ? l.billBarcode : '',
      typeof l.unit === 'string' ? l.unit : '',
      typeof l.billQty === 'number' ? l.billQty : 0,
      typeof l.actualQty === 'number' ? l.actualQty : 0,
      typeof l.unitPrice === 'number' ? l.unitPrice : 0,
      typeof l.discount === 'number' ? l.discount : 0,
      l.discountMode === 'percent' ? 'percent' : 'baht',
      typeof l.type === 'string' ? l.type : 'ค่าสินค้า',
      typeof l.note === 'string' ? l.note : '',
    ]);
  }

  try {
    const sql = getDb();
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO goods_receiving (id, supplier, bill_no, received_date, recorded_by, note)
        VALUES (${id.trim()}, ${supplier.trim()}, ${billNo.trim()}, ${typeof receivedDate === 'string' && receivedDate ? receivedDate : null}, ${payload.username}, ${typeof note === 'string' ? note : ''})
      `;
      if (parsedLines.length > 0) {
        await tx`
          INSERT INTO goods_receiving_lines (receiving_id, sku_id, unii_name, bill_name, bill_barcode, unit, bill_qty, actual_qty, unit_price, discount, discount_mode, line_type, note)
          VALUES ${tx(parsedLines as (string | number)[][])}
        `;
      }
    });
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'บันทึกรับสินค้าเข้าคลังไม่สำเร็จ';
    return { status: 500, body: { error: message } };
  }
}

export async function handleDeleteReceiving(token: string | null, body: unknown): Promise<ApiResult> {
  const payload = verifySessionToken(token);
  if (!payload) return { status: 401, body: { error: 'ต้องเข้าสู่ระบบก่อน' } };
  if (!GRN_ROLES.includes(payload.role)) return { status: 403, body: { error: 'ไม่มีสิทธิ์ลบข้อมูลรับสินค้าเข้าคลัง' } };
  const { id } = (body ?? {}) as Record<string, unknown>;
  if (typeof id !== 'string' || !id.trim()) return { status: 400, body: { error: 'ต้องระบุ id' } };

  try {
    await getDb()`DELETE FROM goods_receiving WHERE id = ${id.trim()}`;
    return { status: 200, body: { ok: true } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'ลบข้อมูลรับสินค้าเข้าคลังไม่สำเร็จ';
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
