#!/usr/bin/env node
// Bulk-sets "วันที่จะจัดส่ง" on the คำสั่งซื้อ VS tab from a
// { "<เลขคำสั่งซื้อ>": "YYYY-MM-DD" } JSON map — for backfilling delivery
// dates that already exist somewhere outside the app (an exported monthly
// sheet, a PDF report) rather than re-typing them one order at a time.
//
// Goes through this app's own /api/route-orders/bulk-update endpoint, so it
// gets the same read-only-column guard, the same one-Sheets-write-per-chunk
// behaviour, and the same single audit-log summary row per chunk as the
// in-app bulk actions. It never talks to Google directly and needs no
// service-account key of its own — just a normal session token.
//
//   Dry run (default — reads only, writes nothing):
//     node scripts/apply-delivery-dates.mjs --file dates.json \
//       --base https://your-app.vercel.app --token "$TOKEN"
//
//   Apply for real:
//     ... --apply
//
// Get $TOKEN by logging into the app and copying the session token your
// browser stores (the same one the app sends as `Authorization: Bearer`).
// The account must be administrator / manager / admin_staff.

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const APPLY = args.includes('--apply');
const FILE = arg('file');
const BASE = (arg('base') || 'http://localhost:8787').replace(/\/$/, '');
const TOKEN = arg('token') || process.env.UFLOW_TOKEN || '';
// One HTTP request per chunk. Kept well under the Sheets API's per-request
// limits: the backend turns each order into its own range in a single
// values.batchUpdate, and a few thousand ranges in one call is asking for a
// 413 rather than a fast write.
const CHUNK = Number(arg('chunk', '250'));

if (!FILE) {
  console.error('usage: node scripts/apply-delivery-dates.mjs --file <map.json> [--base URL] [--token T] [--chunk N] [--apply]');
  process.exit(1);
}
if (!TOKEN) {
  console.error('missing --token (or UFLOW_TOKEN) — the endpoint requires a logged-in session');
  process.exit(1);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const raw = JSON.parse(readFileSync(FILE, 'utf8'));
const wanted = new Map();
const malformed = [];
for (const [orderNo, iso] of Object.entries(raw)) {
  if (typeof iso === 'string' && ISO.test(iso)) wanted.set(orderNo.trim(), iso);
  else malformed.push(`${orderNo} -> ${JSON.stringify(iso)}`);
}
if (malformed.length > 0) {
  console.error(`refusing to run: ${malformed.length} entries are not YYYY-MM-DD`);
  for (const m of malformed.slice(0, 10)) console.error('   ', m);
  process.exit(1);
}
console.log(`loaded ${wanted.size} order → date pairs from ${FILE}`);

const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

/** Sheet dates read back as M/D/YYYY; compare on a normalised ISO form so an
 * order that already carries the right date isn't rewritten for nothing. */
function sheetDateToIso(text) {
  const m = String(text ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${String(Number(m[1])).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}`;
}

// ---- read current state first, so the run reports what would actually
// change instead of just how many rows it intends to touch ----
let current = null;
try {
  const res = await fetch(`${BASE}/api/route-orders/staff-info`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  current = new Map((body.rows ?? []).map((r) => [String(r['เลขคำสั่งซื้อ'] ?? '').trim(), sheetDateToIso(r['วันที่จะจัดส่ง'])]));
  console.log(`read ${current.size} existing rows from คำสั่งซื้อ VS`);
} catch (err) {
  console.warn(`could not read current state (${err.message}) — continuing without a diff`);
}

const toWrite = new Map();
let unchanged = 0;
let newRows = 0;
for (const [orderNo, iso] of wanted) {
  if (current) {
    if (!current.has(orderNo)) newRows++;
    else if (current.get(orderNo) === iso) {
      unchanged++;
      continue; // already correct — skip
    }
  }
  toWrite.set(orderNo, iso);
}

console.log('');
console.log(`already correct, skipping : ${unchanged}`);
console.log(`will be written           : ${toWrite.size}`);
if (current) console.log(`  ...of which have no row yet (a new row gets appended): ${newRows}`);
console.log(`chunks of ${CHUNK}          : ${Math.ceil(toWrite.size / CHUNK)}`);

if (toWrite.size === 0) {
  console.log('\nnothing to do.');
  process.exit(0);
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing was written. Re-run with --apply to write.');
  console.log('first 5 that would change:');
  for (const [o, d] of [...toWrite].slice(0, 5)) console.log(`   ${o} -> ${d}${current && !current.has(o) ? '  (new row)' : ''}`);
  process.exit(0);
}

const entries = [...toWrite];
let ok = 0;
const failures = [];
for (let i = 0; i < entries.length; i += CHUNK) {
  const slice = entries.slice(i, i + CHUNK);
  const dates = Object.fromEntries(slice);
  const label = `chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(entries.length / CHUNK)} (${slice.length})`;
  try {
    const res = await fetch(`${BASE}/api/route-orders/bulk-update`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderNos: slice.map(([o]) => o), action: 'setDeliveryDate', dates }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    ok += body.succeeded?.length ?? 0;
    for (const f of body.failed ?? []) failures.push(f);
    console.log(`${label}: ok ${body.succeeded?.length ?? 0}, failed ${body.failed?.length ?? 0}`);
  } catch (err) {
    console.error(`${label}: REQUEST FAILED — ${err.message}`);
    for (const [o, d] of slice) failures.push({ orderNo: o, reason: `chunk failed: ${err.message}`, date: d });
  }
}

console.log('');
console.log(`done. written ${ok}, failed ${failures.length}`);
if (failures.length > 0) {
  console.log('failures:');
  for (const f of failures.slice(0, 40)) console.log(`   ${f.orderNo}: ${f.reason}`);
  if (failures.length > 40) console.log(`   ...and ${failures.length - 40} more`);
  process.exit(1);
}
