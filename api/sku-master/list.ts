import { handleFetchSkuMasterList } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Single-purpose (not a catch-all) since this is the only route SKU Master
// needs — reads the product-catalog spreadsheet (a different sheet than the
// main one, see src/config/sheets.ts's SKU_SHEET_ID) through the Service
// Account. Used to be a public CSV export read straight from the browser,
// which broke once the spreadsheet stopped being publicly shared.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { status, body } = await handleFetchSkuMasterList(bearerToken(req.headers.authorization));
  res.status(status).json(body);
}
