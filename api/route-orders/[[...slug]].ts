import { handleExportRouteOrders, handleFetchApiImportOrders, handleListRouteOrders, handleUpdateRouteOrder } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { sendResult } from '../_send.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Kept as a [[...slug]] catch-all (matching every other api/ route in this
// project). GET 'list' now reads the staff-entered order overlay from
// Postgres (replacing the old "คำสั่งซื้อ VS" Sheets tab — see
// server/lib.ts's handleListRouteOrders) instead of the frontend fetching
// it itself via public CSV export, since Postgres has no equivalent public
// read path.
//
// Deliberately NOT a bare '' slug for the list route (unlike this project's
// very first version of this file): in production, a plain GET
// /api/route-orders (zero path segments past the catch-all's own prefix)
// 404'd even though every named sub-path on this exact same deployed
// function — /api/route-orders/api-import, /update, /export — worked fine.
// Since local dev never exercises Vercel's own file-system route matching
// at all (server/index.ts below wires an explicit Express route for every
// path instead, see its own comment), that zero-segment case was never
// actually verified against the real platform before shipping. Rather than
// keep trusting undocumented behavior for the one case this project has no
// way to test locally, every list endpoint across this codebase now uses an
// explicit 'list' sub-path instead — exactly the same shape already proven
// to work for every other named action here.
//
// GET 'api-import' proxies the Unii API directly (see server/unii.ts),
// replacing the old public "API Import" Sheets CSV export. maxDuration is
// raised from the platform default since a cold cache miss may need several
// paginated round-trips to Unii before it can respond.
export const config = {
  maxDuration: 30,
};

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/route-orders');

  if (slug === 'list' && req.method === 'GET') {
    const { status, body } = await handleListRouteOrders(bearerToken(req.headers.authorization));
    res.status(status).json(body);
    return;
  }
  if (slug === 'update' && req.method === 'POST') {
    const { status, body } = await handleUpdateRouteOrder(bearerToken(req.headers.authorization), req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'api-import' && req.method === 'GET') {
    const { status, body } = await handleFetchApiImportOrders(bearerToken(req.headers.authorization));
    res.status(status).json(body);
    return;
  }
  if (slug === 'export' && req.method === 'GET') {
    sendResult(res, await handleExportRouteOrders(bearerToken(req.headers.authorization)));
    return;
  }
  logUnmatchedRoute('route-orders', req, slug);
  res.status(404).json({ error: 'Not found' });
}
