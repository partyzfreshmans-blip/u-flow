import { MAX_UPLOAD_BYTES } from '../../src/config/drive.js';
import { handleDriveUpload, type UploadFile } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { runMiddleware, upload } from '../_multipart.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Multer needs the raw request stream, so Vercel's automatic body parsing
// (which only understands json/urlencoded/text anyway) must stay off here.
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    await runMiddleware(req, res, upload.array('files', 10));
  } catch (err: unknown) {
    const isTooLarge = (err as { code?: string } | null)?.code === 'LIMIT_FILE_SIZE';
    res.status(isTooLarge ? 413 : 400).json({
      error: isTooLarge ? `ไฟล์ใหญ่เกิน ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB` : 'อ่านไฟล์ที่อัปโหลดไม่สำเร็จ',
    });
    return;
  }

  const files = ((req as unknown as { files?: UploadFile[] }).files ?? []) as UploadFile[];
  const bodyFields = (req.body ?? {}) as Record<string, unknown>;
  const scope = String(bodyFields.scope ?? '');
  const key = String(bodyFields.key ?? '').trim();

  const { status, body } = await handleDriveUpload(bearerToken(req.headers.authorization), files, scope, key);
  res.status(status).json(body);
}
