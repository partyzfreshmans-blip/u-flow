import { handleCreateUser, handleListUsers, handleUpdateUser } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates api/users/index.ts + api/users/create.ts + api/users/update.ts
// into one Vercel Serverless Function — see api/auth/[[...slug]].ts for why
// (Hobby plan's 12-function-per-deployment cap). Same external URLs
// (/api/users, /api/users/create, /api/users/update), zero frontend changes.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slugParam = req.query.slug;
  const slug = Array.isArray(slugParam) ? slugParam.join('/') : (slugParam ?? '');
  const token = bearerToken(req.headers.authorization);

  if (slug === '' && req.method === 'GET') {
    const { status, body } = await handleListUsers(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'create' && req.method === 'POST') {
    const { status, body } = await handleCreateUser(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'update' && req.method === 'POST') {
    const { status, body } = await handleUpdateUser(token, req.body);
    res.status(status).json(body);
    return;
  }
  res.status(404).json({ error: 'Not found' });
}
