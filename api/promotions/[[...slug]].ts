import { handleListPromotions, handleUpsertPromotion } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Was a single-file api/promotions/upsert.ts — converted to a [[...slug]]
// catch-all (matching every other api/ route) to add a read endpoint
// without adding a new Vercel Serverless Function (see
// api/auth/[[...slug]].ts for why that matters on the Hobby plan). GET
// 'list' replaces the old public "โปรโมชั่น" CSV export read, now that
// promotions live in Postgres (which has no equivalent public read path) —
// 'list', not a bare '' slug, since see api/route-orders/[[...slug]].ts's
// comment for why a zero-segment slug 404'd in production on that identical
// pattern.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/promotions');

  if (slug === 'list' && req.method === 'GET') {
    const { status, body } = await handleListPromotions(bearerToken(req.headers.authorization));
    res.status(status).json(body);
    return;
  }
  if (slug === 'upsert' && req.method === 'POST') {
    const { status, body } = await handleUpsertPromotion(bearerToken(req.headers.authorization), req.body);
    res.status(status).json(body);
    return;
  }
  logUnmatchedRoute('promotions', req, slug);
  res.status(404).json({ error: 'Not found' });
}
