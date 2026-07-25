import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import { google } from 'googleapis';
import multer from 'multer';
import { Readable } from 'node:stream';
import {
  DRIVE_ROOT_FOLDER_ENV,
  MAX_UPLOAD_BYTES,
  driveFolderPath,
  isAllowedFile,
  type AttachmentScope,
} from '../src/config/drive';
import { MAIN_SHEET_ID, SHEET_TABS } from '../src/config/sheets';

// Backend for everything that needs Google credentials: the CS Master
// lat/lng write-back, and Drive uploads for order documents and supplier
// bills.
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

app.get('/health', (_req, res) => {
  const configured = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();
  res.json({
    ok: true,
    serviceAccountConfigured: configured,
    driveFolderConfigured: !!process.env[DRIVE_ROOT_FOLDER_ENV]?.trim(),
    // With no credentials the upload endpoint answers with a stand-in file so
    // the UI can be exercised end to end before Drive is wired up.
    driveMockMode: !configured || !process.env[DRIVE_ROOT_FOLDER_ENV]?.trim(),
  });
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } });

app.post('/api/drive/upload', (req, res) => {
  upload.array('files', 10)(req, res, async (uploadErr: unknown) => {
    if (uploadErr) {
      const isTooLarge = (uploadErr as { code?: string }).code === 'LIMIT_FILE_SIZE';
      return res.status(isTooLarge ? 413 : 400).json({
        error: isTooLarge ? `ไฟล์ใหญ่เกิน ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` : 'อ่านไฟล์ที่อัปโหลดไม่สำเร็จ',
      });
    }

    const files = (req.files ?? []) as Express.Multer.File[];
    const scope = String((req.body as Record<string, unknown>)?.scope ?? '') as AttachmentScope;
    const key = String((req.body as Record<string, unknown>)?.key ?? '').trim();

    if (files.length === 0) return res.status(400).json({ error: 'ไม่พบไฟล์ที่จะอัปโหลด' });
    if (scope !== 'order' && scope !== 'receiving') return res.status(400).json({ error: 'scope ต้องเป็น order หรือ receiving' });
    if (!key) return res.status(400).json({ error: 'ต้องระบุ key (เลขออเดอร์ หรือ วันที่-ซัพพลายเออร์)' });

    const rejected = files.find((f) => !isAllowedFile(f.mimetype, f.originalname));
    if (rejected) {
      return res.status(415).json({ error: `"${rejected.originalname}" ไม่ใช่ไฟล์ PDF/JPG/PNG` });
    }

    const rootFolderId = process.env[DRIVE_ROOT_FOLDER_ENV]?.trim();
    const hasCredentials = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim();

    // Mock mode: keeps the whole attach → list → open flow testable before the
    // Service Account and Drive folder exist. Never used once both are set.
    if (!hasCredentials || !rootFolderId) {
      return res.json({
        ok: true,
        mock: true,
        files: files.map((f) => ({
          fileId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: f.originalname,
          mimeType: f.mimetype,
          size: f.size,
          webViewLink: '',
        })),
      });
    }

    try {
      const drive = await getDriveClient();
      const folderId = await ensureFolderPath(drive, rootFolderId, driveFolderPath(scope, key));

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

      return res.json({ ok: true, mock: false, files: uploaded });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'อัปโหลดไฟล์ไม่สำเร็จ';
      console.error('[drive/upload]', message);
      return res.status(502).json({ error: `อัปโหลดขึ้น Google Drive ไม่สำเร็จ: ${message}` });
    }
  });
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
  console.log(`Warehouse Ops API listening on http://localhost:${PORT}`);
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY?.trim()) {
    console.warn('⚠  GOOGLE_SERVICE_ACCOUNT_KEY is not set — sheet write-back will fail; Drive uploads run in mock mode');
  }
  if (!process.env[DRIVE_ROOT_FOLDER_ENV]?.trim()) {
    console.warn(`⚠  ${DRIVE_ROOT_FOLDER_ENV} is not set — Drive uploads run in mock mode`);
  }
});
