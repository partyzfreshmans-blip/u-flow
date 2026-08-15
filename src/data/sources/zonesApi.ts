import type { Zone } from '../zones';
import { authHeaders, type Session } from '../session';

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback;
}

/** Any authenticated user can read zones — the Planner map and every page
 * that colours a pin by zone needs this. Folded onto the batch-routes
 * catch-all function server-side (see api/batch-routes/[[...slug]].ts). */
export async function fetchZones(session: Session | null): Promise<Zone[]> {
  const res = await fetch('/api/batch-routes/zones-list', { headers: authHeaders(session) });
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `โหลดข้อมูลโซนไม่สำเร็จ (HTTP ${res.status})`));
  return Array.isArray(body.zones) ? (body.zones as Zone[]) : [];
}

/** Whole-list replace, administrator-only (enforced server-side too — this
 * is not the only guard). List order IS priority: index 0 wins first. */
export async function saveZones(session: Session | null, zones: Zone[]): Promise<Zone[]> {
  const res = await fetch('/api/batch-routes/zones-save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({ zones }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `บันทึกโซนไม่สำเร็จ (HTTP ${res.status})`));
  return Array.isArray(body.zones) ? (body.zones as Zone[]) : zones;
}
