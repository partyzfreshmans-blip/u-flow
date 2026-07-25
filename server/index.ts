import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import { google } from 'googleapis';
import { MAIN_SHEET_ID, SHEET_TABS } from '../src/config/sheets';

// Write-back backend for the CS Master lat/lng correction feature.
//
// The Google Service Account private key lives ONLY here, in the
// GOOGLE_SERVICE_ACCOUNT_KEY env var — never in the browser bundle. The
// frontend calls this server, which is the only thing holding credentials.

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.SERVER_PORT ?? 8787);
const CS_MASTER_GID = Number(SHEET_TABS.csMaster.gid);

// Columns in the CS Master tab: A=ชื่อ B=เบอร์ C=ที่อยู่ D=ละ(lat) E=ลอง(lng)
const LAT_COLUMN = 'D';
const LNG_COLUMN = 'E';
const NAME_COLUMN_INDEX = 0;
const PHONE_COLUMN_INDEX = 1;

function getServiceAccountCredentials(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw || raw.trim() === '') {
    throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_SERVICE_ACCOUNT_KEY ใน .env');
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
  // Escaped newlines survive being pasted into a single-line .env value.
  return { client_email: creds.client_email, private_key: creds.private_key.replace(/\\n/g, '\n') };
}

async function getSheetsClient() {
  const { client_email, private_key } = getServiceAccountCredentials();
  const auth = new google.auth.JWT({
    email: client_email,
    key: private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  await auth.authorize();
  return google.sheets({ version: 'v4', auth });
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

app.get('/health', (_req, res) => {
  const configured = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  res.json({ ok: true, serviceAccountConfigured: configured });
});

app.post('/api/cs-master/update-location', async (req, res) => {
  const { name, phone, lat, lng } = req.body ?? {};

  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'ต้องระบุชื่อลูกค้า' });
  }
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat/lng ต้องเป็นตัวเลข' });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'lat/lng อยู่นอกช่วงที่เป็นไปได้' });
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
      return res.status(404).json({ error: `ไม่พบลูกค้า "${wantedName}" ในชีท CS Master` });
    }
    // Refuse to guess when the identifiers are ambiguous — writing to the
    // wrong customer's row is worse than making someone disambiguate.
    if (matches.length > 1) {
      return res.status(409).json({ error: `พบลูกค้าชื่อ "${wantedName}" ซ้ำกัน ${matches.length} แถว (แถว ${matches.join(', ')}) — โปรดแก้ไขในชีทโดยตรง` });
    }
    const targetRow = matches[0];

    await sheets.spreadsheets.values.update({
      spreadsheetId: MAIN_SHEET_ID,
      range: `${title}!${LAT_COLUMN}${targetRow}:${LNG_COLUMN}${targetRow}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[lat, lng]] },
    });

    return res.json({ ok: true, updatedRow: targetRow });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ';
    console.error('[cs-master/update-location]', message);
    return res.status(500).json({ error: message });
  }
});

app.listen(PORT, () => {
  console.log(`CS Master write-back API listening on http://localhost:${PORT}`);
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim()) {
    console.warn('⚠  GOOGLE_SERVICE_ACCOUNT_KEY is not set — write-back will fail until it is configured in .env');
  }
});
