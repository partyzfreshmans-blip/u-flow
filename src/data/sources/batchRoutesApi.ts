import type { BatchRoute } from '../batchRoutes';
import { authHeaders, type Session } from '../session';

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback;
}

export async function fetchBatchRoutes(session: Session): Promise<BatchRoute[]> {
  const res = await fetch('/api/batch-routes', { headers: authHeaders(session) });
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `โหลด Batch Route ไม่สำเร็จ (HTTP ${res.status})`));
  return Array.isArray(body.batchRoutes) ? (body.batchRoutes as BatchRoute[]) : [];
}

/** Sends the whole current batchRoutes list — the backend matches by id and
 * updates/appends accordingly. See handleUpsertBatchRoutes for the
 * driver-role field-level restriction (COD-close only, own vehicle only). */
export async function upsertBatchRoutes(session: Session, batchRoutes: BatchRoute[]): Promise<void> {
  const res = await fetch('/api/batch-routes/upsert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({ batchRoutes }),
  });
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(errorMessage(body, `บันทึก Batch Route ไม่สำเร็จ (HTTP ${res.status})`));
  }
}
