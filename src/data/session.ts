// Client-side session storage. The token itself is opaque here (signed and
// verified server-side — see server/session.ts); this module just persists
// it across reloads and decodes the payload for display/UI-gating purposes.
// Decoding client-side is convenience only, never trust — every backend
// write endpoint re-verifies the token's signature independently.

import type { Role } from '../config/permissions';

export interface Session {
  token: string;
  username: string;
  role: Role;
  driverVehicleId: string | null;
}

const STORAGE_KEY = 'warehouse-ops.session.v1';

/** Reads the token's own embedded expiry (base64url JSON payload before the
 * signature dot) — a quick client-side check so an expired session doesn't
 * sit around looking logged-in until the next backend call fails. The real
 * enforcement is still server-side signature+expiry verification; this is
 * only for prompt UI behavior. */
function isExpired(token: string): boolean {
  const payloadB64 = token.split('.')[0];
  if (!payloadB64) return true;
  try {
    const json = atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp !== 'number' || payload.exp < Date.now();
  } catch {
    return true;
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const s = parsed as Partial<Session>;
    if (typeof s.token !== 'string' || typeof s.username !== 'string' || typeof s.role !== 'string') return null;
    if (isExpired(s.token)) {
      clearSession();
      return null;
    }
    return { token: s.token, username: s.username, role: s.role as Role, driverVehicleId: s.driverVehicleId ?? null };
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable (private mode) — session stays in memory for this tab only */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clean up if storage was never available */
  }
}

/** Headers to attach to any backend call that needs to know who's calling. */
export function authHeaders(session: Session | null): Record<string, string> {
  return session ? { Authorization: `Bearer ${session.token}` } : {};
}
