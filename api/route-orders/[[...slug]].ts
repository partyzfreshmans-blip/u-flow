import { handleExportRouteOrders, handleFetchApiImportOrders, handleFetchStaffOrderInfoList, handleUpdateRouteOrder } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import { sendResult } from '../_send.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Kept as a [[...slug]] catch-all (matching every other api/ route in this
// project). "api-import" reads the raw order tab (see
// handleFetchApiImportOrders); "staff-info" reads "คำสั่งซื้อ VS" (see
// handleFetchStaffOrderInfoList — used to be a public CSV export read
// straight from the browser, which broke once the spreadsheet stopped
// being publicly shared); "update" writes staff-entered fields into that
// same tab — order data is joined between the two at runtime, never synced
// (see src/data/sources/routeOrders.ts); "export" streams back a .xlsx of
// that same join instead of JSON.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/route-orders');
  const token = bearerToken(req.headers.authorization);

  if (slug === 'api-import' && req.method === 'GET') {
    const { status, body } = await handleFetchApiImportOrders(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'staff-info' && req.method === 'GET') {
    const { status, body } = await handleFetchStaffOrderInfoList(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'update' && req.method === 'POST') {
    const { status, body } = await handleUpdateRouteOrder(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'export' && req.method === 'GET') {
    sendResult(res, await handleExportRouteOrders(token));
    return;
  }
  logUnmatchedRoute('route-orders', req, slug);
  res.status(404).json({ error: 'Not found' });
}
