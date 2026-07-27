import { handleLogin, handleMe } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates what used to be api/auth/login.ts + api/auth/me.ts into one
// Vercel Serverless Function via an optional catch-all route ([[...slug]]
// matches /api/auth, /api/auth/login, /api/auth/me, etc., with the matched
// segments in req.query.slug) — the Hobby plan caps a deployment at 12
// functions total, and this repo's api/ directory was one file over that
// once the driver-booking endpoints were added, so every deploy since has
// silently failed and kept serving a stale build. Same external URLs
// (/api/auth/login, /api/auth/me), zero frontend changes needed.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slugParam = req.query.slug;
  const slug = Array.isArray(slugParam) ? slugParam.join('/') : (slugParam ?? '');

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
  res.status(404).json({ error: 'Not found' });
}
