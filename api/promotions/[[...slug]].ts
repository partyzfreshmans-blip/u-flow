import { handleFetchPromotionsList, handleUpsertPromotion } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates api/promotions/upsert.ts + a new 'list' read route into one
// Vercel Serverless Function — see api/auth/[[...slug]].ts for why (Hobby
// plan's 12-function-per-deployment cap) and why the sub-path comes from
// req.url via routeSlug rather than req.query.slug. 'list' reads the
// โปรโมชั่น tab through the Service Account (see handleFetchPromotionsList)
// — this used to be a public CSV export read straight from the browser,
// which broke the moment the spreadsheet stopped being publicly shared.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/promotions');
  const token = bearerToken(req.headers.authorization);

  if (slug === 'list' && req.method === 'GET') {
    const { status, body } = await handleFetchPromotionsList(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'upsert' && req.method === 'POST') {
    const { status, body } = await handleUpsertPromotion(token, req.body);
    res.status(status).json(body);
    return;
  }
  logUnmatchedRoute('promotions', req, slug);
  res.status(404).json({ error: 'Not found' });
}
