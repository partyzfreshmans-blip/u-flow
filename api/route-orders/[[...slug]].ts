import { handleUpdateRouteOrder } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Kept as a [[...slug]] catch-all (matching every other api/ route in this
// project) even though "update" is the only sub-path now — there used to be
// a "sync" one too (the API Import <-> คำสั่งซื้อ VS merge job), removed once
// order data moved to a runtime join instead of a sync (see
// src/data/sources/routeOrders.ts).
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/route-orders');

  if (slug === 'update' && req.method === 'POST') {
    const { status, body } = await handleUpdateRouteOrder(bearerToken(req.headers.authorization), req.body);
    res.status(status).json(body);
    return;
  }
  res.status(404).json({ error: 'Not found' });
}
