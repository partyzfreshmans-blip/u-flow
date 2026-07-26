import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { DRIVE_ROOT_FOLDER_ENV, MAX_UPLOAD_BYTES } from '../src/config/drive.js';
import { handleDriveUpload, handleHealth, handleUpdateCsMasterLocation, handleUpdateRouteOrder } from './lib.js';

// Local dev server: thin Express wrapper around server/lib.ts. The same
// handlers are also called from api/*.ts as Vercel serverless functions in
// production — this file exists only so `npm run server` + the Vite dev
// proxy (see vite.config.ts) give a working backend on localhost.

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.SERVER_PORT ?? 8787);

app.get('/health', (_req, res) => {
  const { status, body } = handleHealth();
  res.status(status).json(body);
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
    const scope = String((req.body as Record<string, unknown>)?.scope ?? '');
    const key = String((req.body as Record<string, unknown>)?.key ?? '').trim();
    const { status, body } = await handleDriveUpload(files, scope, key);
    res.status(status).json(body);
  });
});

app.post('/api/cs-master/update-location', async (req, res) => {
  const { status, body } = await handleUpdateCsMasterLocation(req.body);
  res.status(status).json(body);
});

app.post('/api/route-orders/update', async (req, res) => {
  const { status, body } = await handleUpdateRouteOrder(req.body);
  res.status(status).json(body);
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
