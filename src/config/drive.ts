// Single source of truth for Google Drive storage. Folder IDs come from the
// environment so they are never hardcoded across the codebase — only the
// folder *names* and the upload rules live here.

/** Root Drive folder that everything is filed under. Read server-side only;
 * the browser never needs it. */
export const DRIVE_ROOT_FOLDER_ENV = 'GOOGLE_DRIVE_ROOT_FOLDER_ID';

/** Top-level folders inside the root. */
export const DRIVE_FOLDERS = {
  /** Delivery notes / receipts / tax invoices printed for a customer order. */
  customerDocs: 'ใบส่งสินค้า-ลูกค้า',
  /** Supplier bills backing a goods-receiving record. */
  supplierBills: 'บิลรับเข้า-supplier',
  /** Photo evidence a driver attaches when a stop can't be delivered. */
  deliveryFailures: 'ส่งไม่สำเร็จ',
} as const;

export type AttachmentScope = 'order' | 'receiving' | 'deliveryFailure';

/**
 * Folder path a file belongs in, relative to the Drive root.
 *   order            → ใบส่งสินค้า-ลูกค้า/UM-260724-4775532441
 *   receiving        → บิลรับเข้า-supplier/2026-07-25-บ.สหพัฒนพิบูล จำกัด
 *   deliveryFailure  → ส่งไม่สำเร็จ/UM-260724-4775532441
 */
export function driveFolderPath(scope: AttachmentScope, key: string): string[] {
  if (scope === 'order') return [DRIVE_FOLDERS.customerDocs, sanitizeSegment(key)];
  if (scope === 'deliveryFailure') return [DRIVE_FOLDERS.deliveryFailures, sanitizeSegment(key)];
  return [DRIVE_FOLDERS.supplierBills, sanitizeSegment(key)];
}

/** Drive tolerates most characters, but slashes break the path model. */
export function sanitizeSegment(s: string): string {
  return (s || 'ไม่ระบุ').replace(/[/\\]/g, '-').trim().slice(0, 120);
}

/** GOOGLE_DRIVE_ROOT_FOLDER_ID is meant to hold just the folder ID, but the
 * easiest thing to copy from a browser is the full "share" URL Drive shows
 * (.../drive/folders/<id>?usp=sharing, or .../open?id=<id>) — pull the ID out
 * of either shape instead of sending the whole URL to the Drive API as if it
 * were an ID, which fails with a confusing "File not found". */
export function extractDriveFolderId(raw: string): string {
  const trimmed = raw.trim();
  const folderPath = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderPath) return folderPath[1];
  const idParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idParam) return idParam[1];
  return trimmed;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB per file

export const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'] as const;

/** Accept attribute for <input type="file">. */
export const UPLOAD_ACCEPT = ALLOWED_MIME_TYPES.join(',');

export function isAllowedFile(mimeType: string, fileName: string): boolean {
  if ((ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) return true;
  // Some browsers/scanners report an empty or generic type; fall back to the
  // extension so a legitimate PDF/JPEG is not rejected outright.
  const lower = fileName.toLowerCase();
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
