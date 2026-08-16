import { authHeaders, type Session } from '../session';

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback;
}

export interface UniiSyncResult {
  ok: boolean;
  /** true = this run didn't reach the true end of the order list (hit the
   * time budget, a page cap, or a page that failed after retries) — the
   * cache still only holds what's been fetched so far this cycle; trigger
   * another sync to continue from resumeFromPage. */
  partial: boolean;
  pagesThisRun: number;
  rowsPerPage: number[];
  totalOrdersInCache: number;
  cumulativeCycleOrders: number;
  distinctStatuses: string[];
  droppedCount: number;
  droppedSamples: string[];
  stoppedReason: 'natural-end' | 'budget' | 'max-pages' | 'page-error';
  pageErrorMessage: string | null;
  resumeFromPage: number;
  log: string[];
  completedAt: string;
}

function parseSyncResult(body: Record<string, unknown>): UniiSyncResult {
  return {
    ok: body.ok === true,
    partial: body.partial === true,
    pagesThisRun: typeof body.pagesThisRun === 'number' ? body.pagesThisRun : 0,
    rowsPerPage: Array.isArray(body.rowsPerPage) ? (body.rowsPerPage as number[]) : [],
    totalOrdersInCache: typeof body.totalOrdersInCache === 'number' ? body.totalOrdersInCache : 0,
    cumulativeCycleOrders: typeof body.cumulativeCycleOrders === 'number' ? body.cumulativeCycleOrders : 0,
    distinctStatuses: Array.isArray(body.distinctStatuses) ? (body.distinctStatuses as string[]) : [],
    droppedCount: typeof body.droppedCount === 'number' ? body.droppedCount : 0,
    droppedSamples: Array.isArray(body.droppedSamples) ? (body.droppedSamples as string[]) : [],
    stoppedReason: (['natural-end', 'budget', 'max-pages', 'page-error'] as const).includes(body.stoppedReason as never)
      ? (body.stoppedReason as UniiSyncResult['stoppedReason'])
      : 'natural-end',
    pageErrorMessage: typeof body.pageErrorMessage === 'string' ? body.pageErrorMessage : null,
    resumeFromPage: typeof body.resumeFromPage === 'number' ? body.resumeFromPage : 1,
    log: Array.isArray(body.log) ? (body.log as string[]) : [],
    completedAt: typeof body.completedAt === 'string' ? body.completedAt : '',
  };
}

/** Administrator/manager only (enforced server-side). One call = one
 * resumable "run" of the paginated Unii fetch — see UniiSyncResult.partial
 * for whether a full cycle finished or another call is needed to continue.
 * Can take a while (paginates through hundreds of pages against a real,
 * possibly-slow third-party API with retries) — the caller should show a
 * real loading state, not assume this resolves quickly. */
export async function syncUniiOrders(session: Session | null): Promise<UniiSyncResult> {
  const res = await fetch('/api/route-orders/sync-unii', {
    method: 'POST',
    headers: authHeaders(session),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `ซิงค์ออเดอร์จาก Unii ไม่สำเร็จ (HTTP ${res.status})`));
  return parseSyncResult(body);
}
