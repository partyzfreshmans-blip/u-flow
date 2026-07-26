import { handleReverseGeocode } from '../../server/lib.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { status, body } = await handleReverseGeocode(req.body);
  res.status(status).json(body);
}
