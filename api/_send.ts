import { isFileResult, type ApiResult, type FileResult } from '../server/lib.js';
import type { ApiResponse } from './_types.js';

/**
 * Every route handler in this project used to always return JSON — file
 * downloads (the .xlsx exports) are the first exception, so every catch-all
 * that might dispatch to one of those checks the result shape here instead
 * of assuming res.json() is always right. Shared so the same branch doesn't
 * have to be copy-pasted into every api/*.ts file that adds an export route.
 */
export function sendResult(res: ApiResponse, result: ApiResult | FileResult): void {
  if (isFileResult(result)) {
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.status(result.status).end(result.buffer);
    return;
  }
  res.status(result.status).json(result.body);
}
