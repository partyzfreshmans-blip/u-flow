import { handleExportBatchRouteHistory, handleListBatchRoutes, handleUpsertBatchRoutes } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import { sendResult } from '../_send.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates api/batch-routes/index.ts + api/batch-routes/upsert.ts into
// one Vercel Serverless Function — see api/auth/[[...slug]].ts for why
// (Hobby plan's 12-function-per-deployment cap) and why the sub-path comes
// from req.url via routeSlug rather than req.query.slug. The list route is
// 'list', not a bare '' slug — a plain GET /api/batch-routes (zero path
// segments) 404'd in production on this identical pattern even though every
// named sub-path on the same deployed function worked fine, and local dev
// can never catch that since it exercises its own Express route table
// instead of Vercel's real file-system routing.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/batch-routes');
  const token = bearerToken(req.headers.authorization);

  if (slug === 'list' && req.method === 'GET') {
    const { status, body } = await handleListBatchRoutes(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'upsert' && req.method === 'POST') {
    const { status, body } = await handleUpsertBatchRoutes(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'export' && req.method === 'GET') {
    sendResult(res, await handleExportBatchRouteHistory(token));
    return;
  }
  logUnmatchedRoute('batch-routes', req, slug);
  res.status(404).json({ error: 'Not found' });
}
