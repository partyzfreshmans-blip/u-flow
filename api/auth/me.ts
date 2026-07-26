import { handleMe } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { status, body } = handleMe(bearerToken(req.headers.authorization));
  res.status(status).json(body);
}
