import { handleCreateBookings, handleDecideBooking, handleListBookings } from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Consolidates api/bookings/index.ts + api/bookings/create.ts +
// api/bookings/decide.ts into one Vercel Serverless Function — see
// api/auth/[[...slug]].ts for why (Hobby plan's 12-function-per-deployment
// cap). Same external URLs (/api/bookings, /api/bookings/create,
// /api/bookings/decide), zero frontend changes.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slugParam = req.query.slug;
  const slug = Array.isArray(slugParam) ? slugParam.join('/') : (slugParam ?? '');
  const token = bearerToken(req.headers.authorization);

  if (slug === '' && req.method === 'GET') {
    const { status, body } = await handleListBookings(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'create' && req.method === 'POST') {
    const { status, body } = await handleCreateBookings(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'decide' && req.method === 'POST') {
    const { status, body } = await handleDecideBooking(token, req.body);
    res.status(status).json(body);
    return;
  }
  res.status(404).json({ error: 'Not found' });
}
