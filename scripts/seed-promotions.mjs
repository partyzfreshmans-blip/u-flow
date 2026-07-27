// One-off utility: creates the real promotion rows described in the
// "Promotions page shows 0 items" fix (see git log) inside the live
// "โปรโมชั่น" Google Sheet tab, via the same Service Account credential the
// rest of the app's write-back features already use.
//
// Requires GOOGLE_SERVICE_ACCOUNT_KEY in the environment (or a .env file —
// this script loads dotenv itself) with Editor access shared on the sheet.
// Run with: node scripts/seed-promotions.mjs
//
// Safe to re-run: it matches existing rows by SKU and updates them in place
// rather than duplicating, exactly like the app's own /api/promotions/upsert
// endpoint (server/lib.ts's handleUpsertPromotion) — this script just calls
// the Sheets API directly instead of going through that HTTP endpoint, since
// there's no logged-in session to authenticate with when run standalone.

import 'dotenv/config';
import { google } from 'googleapis';

const MAIN_SHEET_ID = '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
const PROMOTIONS_GID = 1999566312;

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

// Confirmed from real rows already in the live sheet: dates are zero-padded
// DD-MM-YYYY with hyphens (e.g. "21-07-2026"), NOT M/D/YYYY like the
// คำสั่งซื้อ tab. 90-day window starting today (2026-07-27).
const START = '27-07-2026';
const END = '25-10-2026';
const PERIOD_DAYS = 90;

// SKU codes: 8 of these were cross-checked against a real cached snapshot of
// the "SKU Master Lamphun" sheet from earlier this session and use the ACTUAL
// SKU ID (product names below also corrected to match the real sheet's own
// spelling, e.g. "พีโอนี่" not "ฟีโอนี่", "เลิฟลี่บลูม" not "เลฟลี่สุม"). The
// rest (NEW-xxx) had no match in that snapshot — verify/replace those against
// the live SKU Master before relying on them; the snapshot may also simply be
// out of date, so a placeholder here doesn't guarantee the SKU is truly new.
const PRODUCTS = [
  { sku: 'NEW-BNC-001', name: 'ครีมอาบน้ำเขียว เพอร์เฟค', term: 'แพ็ค(3)ละ 99บาท, หีบ(24)ละ 790บาท', promotionPrice: 99, boxPrice: 790 },
  { sku: 'NEW-BNC-002', name: 'ครีมอาบน้ำแดง เบอร์รี่', term: 'แพ็ค(3)ละ 99บาท, หีบ(24)ละ 790บาท', promotionPrice: 99, boxPrice: 790 },
  { sku: 'NEW-BNC-003', name: 'ครีมอาบน้ำชมพู บิวตี้ฟูลไวท์', term: 'แพ็ค(3)ละ 99บาท, หีบ(24)ละ 790บาท', promotionPrice: 99, boxPrice: 790 },
  { sku: 'U00001400', name: 'เบนเนท สบู่วิตามิน ซี&อี สีส้ม 130ก', term: 'ชิ้นละ 42บาท, แพ็ค(4)ละ 157บาท', promotionPrice: 42, singlePrice: 42 },
  { sku: 'NEW-BNC-005', name: 'โชกุบสึ ครีมอาบน้ำถุง 400ml', term: 'ชิ้นละ 46บาท, แพ็ค(3)ละ 132บาท', promotionPrice: 46, singlePrice: 46 },
  { sku: 'U00001088', name: 'ไฮยีน เอ็กเพิร์ทแคร์ 20มล พีโอนี่ ดำ', term: 'แพ็ค(24)ละ 45บาท, หีบ(15)ละ 660บาท', promotionPrice: 45, boxPrice: 660 },
  { sku: 'NEW-HYG-002', name: 'ไฮยีน ปรับผ้านุ่ม ซันคิสอควา', term: 'แพ็ค(24)ละ 45บาท, หีบ(15)ละ 630บาท', promotionPrice: 45, boxPrice: 630 },
  // Corrected 24->15: the real SKU Master confirms this scent's หีบ (like
  // every sibling scent) contains 15 แพ็ค, not 24 as the original brief said.
  { sku: 'U00001332', name: 'ไฮยีน เอ็กเพิร์ทแคร์ 20มลx24 เลิฟลี่บลูม ชมพู', term: 'แพ็ค(24)ละ 45บาท, หีบ(15)ละ 660บาท', promotionPrice: 45, boxPrice: 660 },
  { sku: 'U00001333', name: 'ไฮยีน เอ็กเพิร์ทแคร์ 20มลx24 แฮปปี้ซัน ส้ม', term: 'แพ็ค(24)ละ 45บาท, หีบ(15)ละ 660บาท', promotionPrice: 45, boxPrice: 660 },
  { sku: 'U00001084', name: 'ไฮยีน เอ็กเพิร์ทแคร์ 20มล มอร์นิ่งฮัก ฟ้า', term: 'แพ็ค(24)ละ 45บาท, หีบ(15)ละ 660บาท', promotionPrice: 45, boxPrice: 660 },
  { sku: 'U00001086', name: 'ไฮยีน เอ็กเพิร์ทแคร์ 20มล ซันไรส์คิส ขาวชมพู', term: 'แพ็ค(24)ละ 45บาท, หีบ(15)ละ 650บาท', promotionPrice: 45, boxPrice: 650 },
  { sku: 'NEW-INS-001', name: 'ชิลด์ท็อกซ์ ดีเลมอนนิน 300ml', term: 'แพ็คละ 145บาท', promotionPrice: 145 },
  { sku: 'NEW-INS-002', name: 'ชิลด์ท็อกซ์ ตะไคร้หอม มด แมลงสาบ 300ml', term: 'แพ็คละ 145บาท', promotionPrice: 145 },
  { sku: 'NEW-INS-003', name: 'ชิลด์ท็อกซ์ กำจัดยุง มด แมลงสาบ ไร้กลิ่น 300ml', term: 'แพ็คละ 145บาท', promotionPrice: 145 },
  { sku: 'NEW-INS-004', name: 'ไบกอน เฟรช สีเขียว 250ml', term: 'แพ็คละ 159บาท', promotionPrice: 159 },
  { sku: 'NEW-INS-005', name: 'ไบกอน ไร้กลิ่น เขียวคาดขาว 250ml', term: 'แพ็คละ 159บาท', promotionPrice: 159 },
  { sku: 'NEW-INS-006', name: 'ไบกอน กรีนที 250ml', term: 'แพ็คละ 159บาท', promotionPrice: 159 },
  { sku: 'NEW-INS-007', name: 'ไบกอน ดีเลมอนนิน ส้ม 250ml', term: 'แพ็คละ 159บาท', promotionPrice: 159 },
  { sku: 'NEW-INS-008', name: 'ไบกอน ลาเวนเดอร์ ม่วง 250ml', term: 'แพ็คละ 159บาท', promotionPrice: 159 },
  { sku: 'NEW-INS-009', name: 'ไบกอน กำจัดปลวก สีส้มดำ 300ml', term: 'แพ็คละ 195บาท', promotionPrice: 195 },
  { sku: 'NEW-ORAL-001', name: 'คอลเกต ยาสีฟันยอดนิยม 150ก', term: 'แพ็คละ 319บาท', promotionPrice: 319 },
  { sku: 'NEW-ORAL-002', name: 'คอลเกต ยาสีฟัน 100ก ยอดนิยม', term: 'แพ็คละ 409บาท', promotionPrice: 409 },
  { sku: 'NEW-ORAL-003', name: 'ไบโอเซฟตี้ แปรงสีฟันสไมล์', term: 'แพ็คละ 105บาท', promotionPrice: 105 },
  { sku: 'NEW-ORAL-004', name: 'ดีเฮิร์บ ยาสีฟันพิงค์เฮอร์เบิล 100กรัม', term: 'แพ็คละ 105บาท', promotionPrice: 105 },
  { sku: 'NEW-ORAL-005', name: 'คอลเกต แปรงสีฟันเอ็กซ์ตร้าคลีน', term: 'แพ็คละ 137บาท', promotionPrice: 137 },
  // UNVERIFIED — user flagged this price as possibly per-piece-within-a-pack
  // rather than per-pack; re-check against the original brochure image.
  { sku: 'NEW-ORAL-006', name: 'ซอลส์ ยาสีฟันสูตรเฟรช 40ก', term: 'ชิ้นละ 140บาท', promotionPrice: 140, singlePrice: 140 },
  { sku: 'NEW-ORAL-007', name: 'คอลเกต แปรงสีฟันเอ็กซ์ตร้าคลีนขนนุ่ม', term: 'แพ็คละ 80บาท', promotionPrice: 80 },
  { sku: 'U00001326', name: 'ซันไลต์ ล้างจาน เลมอน ขวด150มล.', term: 'แพ็ค(6)ละ 59บาท, หีบ(8)ละ 440บาท', promotionPrice: 59, boxPrice: 440 },
  { sku: 'U00001325', name: 'ซันไลต์ ล้างจาน เลมอน ถุง 300มล.', term: 'แพ็ค(3)ละ 46บาท, หีบ(12)ละ 540บาท', promotionPrice: 46, boxPrice: 540 },
  { sku: 'NEW-HH-003', name: 'ไลปอนเอฟ ล้างจานเอ็กซ์ตร้าไฮจินิค 300ml', term: 'แพ็ค(3)ละ 49บาท, หีบ(12)ละ 512บาท', promotionPrice: 49, boxPrice: 512 },
  { sku: 'NEW-HH-004', name: 'บริสเอกเซล ผงซักฟอกเข้มข้น เขียว 750ก', term: 'ชิ้นละ 53บาท, หีบ(12)ละ 624บาท', promotionPrice: 53, boxPrice: 624, singlePrice: 53 },
  { sku: 'NEW-HH-005', name: '108 Shop ผงซักฟอก 3แจ๋วแจ่ม 3000ก', term: 'ชิ้นละ 109บาท, หีบ(4)ละ 425บาท', promotionPrice: 109, boxPrice: 425, singlePrice: 109 },
];

function columnLetter(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function getServiceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw || raw.trim() === '') throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set');
  const creds = JSON.parse(raw);
  if (!creds.client_email || !creds.private_key) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must have client_email and private_key');
  return { client_email: creds.client_email, private_key: creds.private_key.replace(/\\n/g, '\n') };
}

async function getSheetsClient() {
  const { client_email, private_key } = getServiceAccountCredentials();
  const auth = new google.auth.JWT({ email: client_email, key: private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
}

async function resolveSheetTitle(sheets, gid) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
  const match = meta.data.sheets?.find((s) => s.properties?.sheetId === gid);
  const title = match?.properties?.title;
  if (!title) throw new Error(`Could not find a tab with gid=${gid}`);
  return title;
}

async function main() {
  const sheets = await getSheetsClient();
  const title = await resolveSheetTitle(sheets, PROMOTIONS_GID);
  console.log(`Writing to tab: "${title}"`);

  let created = 0;
  let updated = 0;

  for (const p of PRODUCTS) {
    // Re-read fresh every iteration so each new row is visible to the next
    // one's row-count calculation (no batching — same simplicity trade-off
    // as the app's own per-field write-back handlers).
    const current = await sheets.spreadsheets.values.get({ spreadsheetId: MAIN_SHEET_ID, range: `${title}!A:Z` });
    const rows = current.data.values ?? [];
    const header = rows[0] ?? [];
    const headerAt = (name) => header.findIndex((h) => String(h ?? '').trim() === name);

    const skuCol = headerAt(PROMO_SKU_HEADER);
    const statusCol = headerAt(PROMO_STATUS_HEADER);
    const nameCol = headerAt(PROMO_PRODUCT_NAME_HEADER);
    const termCol = headerAt(PROMO_TERM_HEADER);
    const startCol = headerAt(PROMO_START_HEADER);
    const endCol = headerAt(PROMO_END_HEADER);
    const priceCol = headerAt(PROMO_PRICE_HEADER);
    const boxCol = headerAt(PROMO_BOX_PRICE_HEADER);
    const singleCol = headerAt(PROMO_SINGLE_PRICE_HEADER);
    const periodCol = headerAt(PROMO_PERIOD_HEADER);
    if (skuCol === -1 || statusCol === -1 || nameCol === -1 || termCol === -1) {
      throw new Error('Required column(s) missing from the sheet header row — aborting so nothing writes to the wrong column.');
    }

    const matches = [];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i]?.[skuCol] ?? '').trim() === p.sku) matches.push(i + 1);
    }
    if (matches.length > 1) {
      console.error(`SKIP ${p.sku}: duplicate SKU already exists in ${matches.length} rows — fix manually first.`);
      continue;
    }
    const isNew = matches.length === 0;
    const targetRow = isNew ? rows.length + 1 : matches[0];

    const writeCell = async (col, value, valueInputOption = 'RAW') => {
      if (col === -1) return;
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `${title}!${columnLetter(col)}${targetRow}`,
        valueInputOption,
        requestBody: { values: [[value]] },
      });
    };

    await writeCell(skuCol, p.sku);
    await writeCell(statusCol, 'Active');
    await writeCell(nameCol, p.name);
    await writeCell(termCol, p.term);
    await writeCell(startCol, START, 'USER_ENTERED');
    await writeCell(endCol, END, 'USER_ENTERED');
    await writeCell(periodCol, PERIOD_DAYS);
    await writeCell(priceCol, p.promotionPrice);
    if (p.boxPrice !== undefined) await writeCell(boxCol, p.boxPrice);
    if (p.singlePrice !== undefined) await writeCell(singleCol, p.singlePrice);

    console.log(`${isNew ? 'CREATED' : 'UPDATED'} row ${targetRow}: ${p.sku} — ${p.name}`);
    if (isNew) created++;
    else updated++;
  }

  console.log(`\nDone. Created ${created}, updated ${updated}, total ${PRODUCTS.length}.`);
}

main().catch((err) => {
  console.error('FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
