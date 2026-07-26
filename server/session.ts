import { createHmac, timingSafeEqual } from 'node:crypto';

// Hand-rolled signed session token — a base64url JSON payload plus an
// HMAC-SHA256 signature over it (no jsonwebtoken dependency needed for
// something this small). Verified on every request that needs to know who's
// calling; a tampered payload or a different secret both fail signature
// verification, so a client can decode its own token for display but can
// never mint or alter one without the server's secret.
//
// AUTH_SESSION_SECRET must be set in production (Vercel env vars) — without
// it this falls back to an obviously-insecure default so `npm run dev`
// still works out of the box for local testing. That fallback must never be
// relied on once real user accounts exist.
const DEV_FALLBACK_SECRET = 'dev-only-insecure-secret-change-me';

function getSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (secret) return secret;
  console.warn('[session] AUTH_SESSION_SECRET is not set — using an insecure development-only default. Set it in your deployment environment before relying on real logins.');
  return DEV_FALLBACK_SECRET;
}

export interface SessionPayload {
  username: string;
  role: string;
  /** Vehicle id this user is tied to, when role is 'driver'; null otherwise. */
  driverVehicleId: string | null;
  iat: number;
  exp: number;
}

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64url(input: string): Buffer {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function createSessionToken(username: string, role: string, driverVehicleId: string | null): string {
  const now = Date.now();
  const payload: SessionPayload = { username, role, driverVehicleId, iat: now, exp: now + SESSION_TTL_MS };
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload)));
  const sig = base64url(createHmac('sha256', getSecret()).update(payloadB64).digest());
  return `${payloadB64}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expectedSig = base64url(createHmac('sha256', getSecret()).update(payloadB64).digest());
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(fromBase64url(payloadB64).toString('utf8')) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Pulls "Bearer <token>" out of an Authorization header (case-insensitive
 * header lookup, since Node lowercases incoming header names but this keeps
 * the helper safe to reuse anywhere). */
export function bearerToken(authHeader: string | string[] | undefined): string | null {
  const raw = Array.isArray(authHeader) ? authHeader[0] : authHeader;
  if (!raw) return null;
  const m = raw.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
