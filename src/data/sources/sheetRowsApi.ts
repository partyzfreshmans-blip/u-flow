// Shared client for every Sheets tab that used to be read straight from the
// browser via the public CSV export URL (docs.google.com/.../export?format=
// csv&gid=...). That only worked while the spreadsheet stayed link-shared
// "Anyone with the link can view" — once it's set to Restricted, that URL
// redirects to a Google login page instead of CSV, and the browser can't
// read the redirect target cross-origin (surfaces as a bare "Failed to
// fetch", no useful detail). This instead goes through this app's own
// authenticated backend (the Service Account, same path every write-back
// already uses — see server/lib.ts's handleSheetRowsList), which works
// regardless of the spreadsheet's sharing settings.
//
// Returns rows in exactly the shape Papaparse's `{ header: true }` mode
// used to produce (an array of header-keyed objects, every value a string),
// so every per-tab row-mapping function (rowToCustomer, rowToPromo, ...)
// needed zero changes — only where the rows come from.
import { authHeaders, type Session } from '../session';

export interface SheetRowsResult {
  rows: Record<string, string>[];
  stale: boolean;
  error: string | null;
}

export async function fetchSheetRowsFromBackend(session: Session | null, endpoint: string): Promise<SheetRowsResult> {
  let res: Response;
  try {
    res = await fetch(endpoint, { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    if (message) throw new Error(message);
    if (res.status === 404) {
      throw new Error(`ไม่พบ backend endpoint ${endpoint} — ตรวจสอบว่า deploy ล่าสุดสร้าง serverless function นี้จริง`);
    }
    throw new Error(`โหลดข้อมูลไม่สำเร็จ (HTTP ${res.status})`);
  }
  const body = (await res.json()) as { rows?: Record<string, string>[]; stale?: boolean; error?: string | null };
  return { rows: Array.isArray(body.rows) ? body.rows : [], stale: !!body.stale, error: body.error ?? null };
}
