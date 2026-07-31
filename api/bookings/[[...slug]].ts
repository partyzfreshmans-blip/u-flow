import { handleCreateBookings, handleDecideBooking, handleListBookings } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates api/bookings/index.ts + api/bookings/create.ts +
// api/bookings/decide.ts into one Vercel Serverless Function — see
// api/auth/[[...slug]].ts for why (Hobby plan's 12-function-per-deployment
// cap) and why the sub-path comes from req.url via routeSlug rather than
// req.query.slug. The list route is 'list', not a bare '' slug — see
// api/route-orders/[[...slug]].ts's comment for why a zero-segment slug
// 404'd in production on that identical pattern.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/bookings');
  const token = bearerToken(req.headers.authorization);

  if (slug === 'list' && req.method === 'GET') {
    const { status, body } = await handleListBookings(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'create' && req.method === 'POST') {
    const { status, body } = await handleCreateBookings(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'decide' && req.method === 'POST') {
    const { status, body } = await handleDecideBooking(token, req.body);
    res.status(status).json(body);
    return;
  }
  logUnmatchedRoute('bookings', req, slug);
  res.status(404).json({ error: 'Not found' });
}
