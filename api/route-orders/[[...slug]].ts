import { handleSyncRouteOrders, handleUpdateRouteOrder } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates api/route-orders/update.ts + api/route-orders/sync.ts into
// one Vercel Serverless Function — see api/auth/[[...slug]].ts for why
// (Hobby plan's 12-function-per-deployment cap) and why the sub-path comes
// from req.url via routeSlug rather than req.query.slug.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/route-orders');

  if (slug === 'update' && req.method === 'POST') {
    const { status, body } = await handleUpdateRouteOrder(bearerToken(req.headers.authorization), req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'sync' && req.method === 'POST') {
    const { status, body } = await handleSyncRouteOrders(bearerToken(req.headers.authorization));
    res.status(status).json(body);
    return;
  }
  res.status(404).json({ error: 'Not found' });
}
