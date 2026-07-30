import { handleLogin, handleMe } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates what used to be api/auth/login.ts + api/auth/me.ts into one
// Vercel Serverless Function via an optional catch-all route ([[...slug]]
// matches /api/auth, /api/auth/login, /api/auth/me, etc.) — the Hobby plan
// caps a deployment at 12 functions total, and this repo's api/ directory
// was one file over that once the driver-booking endpoints were added, so
// every deploy since had silently failed and kept serving a stale build.
// Same external URLs (/api/auth/login, /api/auth/me), zero frontend changes
// needed. The sub-path is read from req.url (see _routing.ts) rather than
// req.query.slug — that query param wasn't reliably populated in production,
// which made every sub-route 404 here even though the base route worked.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/auth');

  if (slug === 'login' && req.method === 'POST') {
    const { status, body } = await handleLogin(req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'me' && req.method === 'GET') {
    const { status, body } = handleMe(bearerToken(req.headers.authorization));
    res.status(status).json(body);
    return;
  }
  logUnmatchedRoute('auth', req, slug);
  res.status(404).json({ error: 'Not found' });
}
