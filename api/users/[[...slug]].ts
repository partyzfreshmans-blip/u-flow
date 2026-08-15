import { handleCreateUser, handleGetUniiApiKeySetting, handleListUsers, handleSaveUniiApiKeySetting, handleTestUniiApiKey, handleUpdateUser } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates api/users/index.ts + api/users/create.ts + api/users/update.ts
// into one Vercel Serverless Function — see api/auth/[[...slug]].ts for why
// (Hobby plan's 12-function-per-deployment cap) and why the sub-path comes
// from req.url via routeSlug rather than req.query.slug. Same external URLs
// (/api/users, /api/users/create, /api/users/update), zero frontend changes.
//
// The three settings-unii-key* slugs are the Settings page's Unii API Key
// card — folded in here for the same function-cap reason (see zones-list/
// zones-save in api/batch-routes/[[...slug]].ts for the identical pattern);
// they're both administrator-only, same as user management itself.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/users');
  const token = bearerToken(req.headers.authorization);

  if (slug === 'list' && req.method === 'GET') {
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
  if (slug === 'settings-unii-key' && req.method === 'GET') {
    const { status, body } = await handleGetUniiApiKeySetting(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'settings-unii-key-test' && req.method === 'POST') {
    const { status, body } = await handleTestUniiApiKey(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'settings-unii-key' && req.method === 'POST') {
    const { status, body } = await handleSaveUniiApiKeySetting(token, req.body);
    res.status(status).json(body);
    return;
  }
  logUnmatchedRoute('users', req, slug);
  res.status(404).json({ error: 'Not found' });
}
