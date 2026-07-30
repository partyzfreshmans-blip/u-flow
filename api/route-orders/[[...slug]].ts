import { handleExportRouteOrders, handleFetchApiImportOrders, handleListRouteOrders, handleUpdateRouteOrder } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { sendResult } from '../_send.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Kept as a [[...slug]] catch-all (matching every other api/ route in this
// project). GET '' now reads the staff-entered order overlay from Postgres
// (replacing the old "คำสั่งซื้อ VS" Sheets tab — see server/lib.ts's
// handleListRouteOrders) instead of the frontend fetching it itself via
// public CSV export, since Postgres has no equivalent public read path.
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

  if (slug === '' && req.method === 'GET') {
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
