// "Export เป็น Excel" buttons on Order Management and Batch Route History —
// both hit a backend endpoint that returns a real .xlsx file body (not
// JSON), built server-side from the API Import + คำสั่งซื้อ VS + Batch
// Routes sheets (see server/lib.ts's
// handleExportRouteOrders/handleExportBatchRouteHistory). This just fetches
// the blob and triggers a normal browser download; there's no state to keep
// afterward, so it isn't wired through the store/reducer like every other
// data source here.
import { authHeaders, type Session } from '../session';

async function downloadXlsx(url: string, session: Session | null, fallbackFilename: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(session) });
  } catch {
    throw new Error('เชื่อมต่อ backend ไม่ได้ — ลองใหม่อีกครั้ง');
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    const message = body && typeof body === 'object' && 'error' in body ? String((body as { error: unknown }).error) : null;
    throw new Error(message || `Export ไม่สำเร็จ (HTTP ${res.status})`);
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filenameMatch = /filename="([^"]+)"/.exec(disposition);
  const filename = filenameMatch?.[1] ?? fallbackFilename;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}

export function exportRouteOrdersXlsx(session: Session | null): Promise<void> {
  return downloadXlsx('/api/route-orders/export', session, 'orders.xlsx');
}

export function exportBatchRouteHistoryXlsx(session: Session | null): Promise<void> {
  return downloadXlsx('/api/batch-routes/export', session, 'batch-route-history.xlsx');
}
