import { MAX_UPLOAD_BYTES, humanFileSize, isAllowedFile, type AttachmentScope } from '../../config/drive';

// Uploads go through the local backend (server/), which is the only place the
// Service Account credential exists. Attachment metadata is kept in
// localStorage for now — the spec explicitly defers writing it back to Sheets.

const API_BASE: string = import.meta.env.VITE_CS_MASTER_API_URL || 'http://localhost:8787';
const STORAGE_KEY = 'warehouse-ops.attachments.v1';

export interface Attachment {
  fileId: string;
  name: string;
  mimeType: string;
  size: number;
  /** Drive link; empty while running in mock mode (no credential yet). */
  webViewLink: string;
  uploadedAt: string;
  /** True when the backend was not wired to Drive and returned a stand-in. */
  mock: boolean;
}

/** scope:key → attachments, e.g. "order:UM-260724-4775532441". */
export type AttachmentIndex = Record<string, Attachment[]>;

export function attachmentKey(scope: AttachmentScope, key: string): string {
  return `${scope}:${key}`;
}

export function loadAttachments(): AttachmentIndex {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as AttachmentIndex) : {};
  } catch {
    return {};
  }
}

export function saveAttachments(index: AttachmentIndex): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(index));
  } catch {
    /* storage unavailable — attachments stay in memory for this session */
  }
}

export class UploadError extends Error {}

/** Reject unusable files in the browser so the user hears about it instantly
 * rather than after a round trip. The server re-checks regardless. */
export function validateFiles(files: File[]): string | null {
  for (const f of files) {
    if (!isAllowedFile(f.type, f.name)) return `"${f.name}" ไม่ใช่ไฟล์ PDF/JPG/PNG`;
    if (f.size > MAX_UPLOAD_BYTES) return `"${f.name}" ใหญ่ ${humanFileSize(f.size)} เกินขีดจำกัด ${humanFileSize(MAX_UPLOAD_BYTES)}`;
    if (f.size === 0) return `"${f.name}" เป็นไฟล์ว่าง`;
  }
  return null;
}

export async function uploadToDrive(scope: AttachmentScope, key: string, files: File[]): Promise<Attachment[]> {
  const invalid = validateFiles(files);
  if (invalid) throw new UploadError(invalid);

  const form = new FormData();
  form.append('scope', scope);
  form.append('key', key);
  for (const f of files) form.append('files', f);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/drive/upload`, { method: 'POST', body: form });
  } catch {
    // Network failure / backend not running — the most common case in the
    // field, so name it plainly instead of surfacing a raw fetch error.
    throw new UploadError('เชื่อมต่อเซิร์ฟเวอร์อัปโหลดไม่ได้ — ตรวจสอบว่ารัน npm run server อยู่ แล้วลองใหม่');
  }

  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : `อัปโหลดไม่สำเร็จ (HTTP ${res.status})`;
    throw new UploadError(message);
  }

  const data = (await res.json()) as { mock?: boolean; files?: Omit<Attachment, 'uploadedAt' | 'mock'>[] };
  const now = new Date().toISOString();
  return (data.files ?? []).map((f) => ({ ...f, uploadedAt: now, mock: !!data.mock }));
}

export function formatUploadedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('th-TH', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export { humanFileSize };
