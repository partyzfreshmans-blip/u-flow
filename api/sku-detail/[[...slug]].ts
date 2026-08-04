import { handleExportOrderLineItems, handleFetchSkuDetailList, handleLinkLineItemPromo } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { logUnmatchedRoute, routeSlug } from '../_routing.js';
import { sendResult } from '../_send.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates api/sku-detail/link-promo.ts + a new 'list' read route into
// one Vercel Serverless Function — see api/auth/[[...slug]].ts for why
// (Hobby plan's 12-function-per-deployment cap) and why the sub-path comes
// from req.url via routeSlug rather than req.query.slug. 'list' reads the
// SKU Detail tab (order line items) through the Service Account (see
// handleFetchSkuDetailList) — this used to be a public CSV export read
// straight from the browser, which broke the moment the spreadsheet
// stopped being publicly shared.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/sku-detail');
  const token = bearerToken(req.headers.authorization);

  if (slug === 'list' && req.method === 'GET') {
    const { status, body } = await handleFetchSkuDetailList(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'link-promo' && req.method === 'POST') {
    const { status, body } = await handleLinkLineItemPromo(token, req.body);
    res.status(status).json(body);
    return;
  }
  // 'export' streams one order's line items back as a .xlsx instead of JSON —
  // a sub-route here rather than its own file, same 12-function reason.
  if (slug === 'export' && req.method === 'POST') {
    sendResult(res, await handleExportOrderLineItems(token, req.body));
    return;
  }
  logUnmatchedRoute('sku-detail', req, slug);
  res.status(404).json({ error: 'Not found' });
}
