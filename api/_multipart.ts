import multer from 'multer';
import { MAX_UPLOAD_BYTES } from '../src/config/drive.js';
import type { ApiRequest, ApiResponse } from './_types.js';

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } });

/** Runs an Express-style middleware (req, res, next) against Vercel's plain
 * Node req/res, so multer — built for Express — works outside of Express.
 * multer's own types expect a full Express Request/Response, which our
 * minimal Vercel types don't structurally match; the cast at this one
 * boundary is the standard way to bridge that, since at runtime it's the
 * same Node req/res object either way. */
export function runMiddleware(
  req: ApiRequest,
  res: ApiResponse,
  fn: (req: never, res: never, cb: (result?: unknown) => void) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    fn(req as never, res as never, (result?: unknown) => {
      if (result instanceof Error) reject(result);
      else resolve();
    });
  });
}
