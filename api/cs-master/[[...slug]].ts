import { handleListCustomerLocationOverrides, handleSyncCustomerNames, handleUpdateCsMasterLocation } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Was a single-file api/cs-master/update-location.ts — converted to a
// [[...slug]] catch-all (matching every other api/ route) to add a read
// endpoint (location-overrides) without adding a new Vercel Serverless
// Function (see api/auth/[[...slug]].ts for why that matters on the Hobby
// plan). The base customer list (name/address/etc.) still comes straight
// from the CS Master Google Sheet on the frontend, unchanged — this only
// adds the Postgres-backed lat/lng override on top (see
// handleUpdateCsMasterLocation's doc comment).
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/cs-master');

  if (slug === 'location-overrides' && req.method === 'GET') {
    const { status, body } = await handleListCustomerLocationOverrides(bearerToken(req.headers.authorization));
    res.status(status).json(body);
    return;
  }
  if (slug === 'update-location' && req.method === 'POST') {
    const { status, body } = await handleUpdateCsMasterLocation(bearerToken(req.headers.authorization), req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'sync-names' && req.method === 'POST') {
    const { status, body } = await handleSyncCustomerNames(bearerToken(req.headers.authorization), req.body);
    res.status(status).json(body);
    return;
  }
  logUnmatchedRoute('cs-master', req, slug);
  res.status(404).json({ error: 'Not found' });
}
