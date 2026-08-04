import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import { DRIVE_ROOT_FOLDER_ENV, MAX_UPLOAD_BYTES } from '../src/config/drive.js';
import {
  handleBulkUpdateRouteOrders,
  handleCreateBookings,
  handleCreateUser,
  handleDecideBooking,
  handleDriveUpload,
  handleExportBatchRouteHistory,
  handleExportOrderLineItems,
  handleExportRouteOrders,
  handleFetchApiImportOrders,
  handleFetchCsMasterList,
  handleFetchPromotionsList,
  handleFetchSkuDetailList,
  handleFetchSkuMasterList,
  handleFetchStaffOrderInfoList,
  handleHealth,
  handleListBatchRoutes,
  handleListBookings,
  handleListUsers,
  handleLogin,
  handleMe,
  handleReverseGeocode,
  handleLinkLineItemPromo,
  handleUpdateCsMasterLocation,
  handleUpdateRouteOrder,
  handleUpdateUser,
  handleUpsertBatchRoutes,
  handleUpsertPromotion,
  isFileResult,
} from './lib.js';
import type { ApiResult, FileResult } from './lib.js';
import { bearerToken } from './session.js';

// Local dev server: thin Express wrapper around server/lib.ts. The same
// handlers are also called from api/*.ts as Vercel serverless functions in
// production — this file exists only so `npm run server` + the Vite dev
// proxy (see vite.config.ts) give a working backend on localhost.

const app = express();
app.use(cors());
app.use(express.json());

/** Same file-vs-JSON branch as api/_send.ts's sendResult — kept as a
 * separate small copy here rather than a shared import, since this file is
 * Express-specific (res here is Express's Response, not the Vercel-shaped
 * ApiResponse api/_send.ts is typed against) and the two runtimes are
 * intentionally kept independent of each other. */
function sendResult(res: express.Response, result: ApiResult | FileResult): void {
  if (isFileResult(result)) {
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.status(result.status).end(result.buffer);
    return;
  }
  res.status(result.status).json(result.body);
}

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
    const { status, body } = await handleDriveUpload(bearerToken(req.headers.authorization), files, scope, key);
    res.status(status).json(body);
  });
});

app.get('/api/cs-master/list', async (req, res) => {
  const { status, body } = await handleFetchCsMasterList(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.post('/api/cs-master/update-location', async (req, res) => {
  const { status, body } = await handleUpdateCsMasterLocation(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.get('/api/route-orders/api-import', async (req, res) => {
  const { status, body } = await handleFetchApiImportOrders(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.get('/api/route-orders/staff-info', async (req, res) => {
  const { status, body } = await handleFetchStaffOrderInfoList(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.post('/api/route-orders/update', async (req, res) => {
  const { status, body } = await handleUpdateRouteOrder(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.post('/api/route-orders/bulk-update', async (req, res) => {
  const { status, body } = await handleBulkUpdateRouteOrders(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.get('/api/route-orders/export', async (req, res) => {
  sendResult(res, await handleExportRouteOrders(bearerToken(req.headers.authorization)));
});

app.post('/api/route-orders/export', async (req, res) => {
  const orderNos = Array.isArray((req.body as { orderNos?: unknown } | undefined)?.orderNos) ? ((req.body as { orderNos: string[] }).orderNos) : undefined;
  sendResult(res, await handleExportRouteOrders(bearerToken(req.headers.authorization), orderNos));
});

app.get('/api/promotions/list', async (req, res) => {
  const { status, body } = await handleFetchPromotionsList(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.post('/api/promotions/upsert', async (req, res) => {
  const { status, body } = await handleUpsertPromotion(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.get('/api/sku-detail/list', async (req, res) => {
  const { status, body } = await handleFetchSkuDetailList(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.post('/api/sku-detail/link-promo', async (req, res) => {
  const { status, body } = await handleLinkLineItemPromo(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.post('/api/sku-detail/export', async (req, res) => {
  sendResult(res, await handleExportOrderLineItems(bearerToken(req.headers.authorization), req.body));
});

app.get('/api/sku-master/list', async (req, res) => {
  const { status, body } = await handleFetchSkuMasterList(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.post('/api/geocode/reverse', async (req, res) => {
  const { status, body } = await handleReverseGeocode(req.body);
  res.status(status).json(body);
});

app.post('/api/auth/login', async (req, res) => {
  const { status, body } = await handleLogin(req.body);
  res.status(status).json(body);
});

app.get('/api/auth/me', (req, res) => {
  const { status, body } = handleMe(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.get('/api/users/list', async (req, res) => {
  const { status, body } = await handleListUsers(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.post('/api/users/create', async (req, res) => {
  const { status, body } = await handleCreateUser(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.post('/api/users/update', async (req, res) => {
  const { status, body } = await handleUpdateUser(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.get('/api/bookings/list', async (req, res) => {
  const { status, body } = await handleListBookings(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.post('/api/bookings/create', async (req, res) => {
  const { status, body } = await handleCreateBookings(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.post('/api/bookings/decide', async (req, res) => {
  const { status, body } = await handleDecideBooking(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.get('/api/batch-routes/list', async (req, res) => {
  const { status, body } = await handleListBatchRoutes(bearerToken(req.headers.authorization));
  res.status(status).json(body);
});

app.post('/api/batch-routes/upsert', async (req, res) => {
  const { status, body } = await handleUpsertBatchRoutes(bearerToken(req.headers.authorization), req.body);
  res.status(status).json(body);
});

app.get('/api/batch-routes/export', async (req, res) => {
  sendResult(res, await handleExportBatchRouteHistory(bearerToken(req.headers.authorization)));
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
