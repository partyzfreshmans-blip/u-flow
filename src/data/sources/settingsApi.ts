import { authHeaders, type Session } from '../session';

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function errorMessage(body: Record<string, unknown>, fallback: string): string {
  return typeof body.error === 'string' ? body.error : fallback;
}

export interface UniiKeySetting {
  hasKey: boolean;
  maskedKey: string;
  updatedAt: string | null;
  updatedBy: string | null;
}

function parseSetting(body: Record<string, unknown>): UniiKeySetting {
  return {
    hasKey: body.hasKey === true,
    maskedKey: typeof body.maskedKey === 'string' ? body.maskedKey : '',
    updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : null,
    updatedBy: typeof body.updatedBy === 'string' ? body.updatedBy : null,
  };
}

/** Administrator-only, folded onto the users catch-all function server-side
 * (see api/users/[[...slug]].ts) to stay under Vercel Hobby's function cap. */
export async function fetchUniiKeySetting(session: Session | null): Promise<UniiKeySetting> {
  const res = await fetch('/api/users/settings-unii-key', { headers: authHeaders(session) });
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `โหลดการตั้งค่า API Key ไม่สำเร็จ (HTTP ${res.status})`));
  return parseSetting(body);
}

export interface UniiKeyTestResult {
  ok: boolean;
  httpStatus?: number;
  latencyMs?: number;
  error?: string;
}

/** A real network probe against Unii, run server-side (browsers can't be
 * trusted to carry the key straight to a third party, and Unii's API has no
 * CORS allowance for this anyway) — nothing is persisted by this call. */
export async function testUniiApiKey(session: Session | null, apiKey: string): Promise<UniiKeyTestResult> {
  const res = await fetch('/api/users/settings-unii-key-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({ apiKey }),
  });
  const body = await readJson(res);
  if (!res.ok) return { ok: false, error: errorMessage(body, `ทดสอบการเชื่อมต่อไม่สำเร็จ (HTTP ${res.status})`) };
  return {
    ok: body.ok === true,
    httpStatus: typeof body.httpStatus === 'number' ? body.httpStatus : undefined,
    latencyMs: typeof body.latencyMs === 'number' ? body.latencyMs : undefined,
    error: typeof body.error === 'string' ? body.error : undefined,
  };
}

/** Persists the key only if the backend's own re-verification (independent
 * of whatever testUniiApiKey reported earlier) succeeds — a non-2xx here
 * means nothing was written; the caller must treat this as a hard failure,
 * never an optimistic success. */
export async function saveUniiApiKey(session: Session | null, apiKey: string): Promise<UniiKeySetting> {
  const res = await fetch('/api/users/settings-unii-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(session) },
    body: JSON.stringify({ apiKey }),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(errorMessage(body, `บันทึก API Key ไม่สำเร็จ (HTTP ${res.status})`));
  return parseSetting(body);
}
