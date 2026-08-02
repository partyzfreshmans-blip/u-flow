import { handleFetchCsMasterList, handleUpdateCsMasterLocation } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates api/cs-master/update-location.ts + a new 'list' read route
// into one Vercel Serverless Function — see api/auth/[[...slug]].ts for why
// (Hobby plan's 12-function-per-deployment cap) and why the sub-path comes
// from req.url via routeSlug rather than req.query.slug. 'list' reads the
// CS Master tab through the Service Account (see handleFetchCsMasterList) —
// this used to be a public CSV export read straight from the browser, which
// broke the moment the spreadsheet stopped being publicly link-shared.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/cs-master');
  const token = bearerToken(req.headers.authorization);

  if (slug === 'list' && req.method === 'GET') {
    const { status, body } = await handleFetchCsMasterList(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'update-location' && req.method === 'POST') {
    const { status, body } = await handleUpdateCsMasterLocation(token, req.body);
    res.status(status).json(body);
    return;
  }
  logUnmatchedRoute('cs-master', req, slug);
  res.status(404).json({ error: 'Not found' });
}
