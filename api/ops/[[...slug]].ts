import {
  handleAppendActivityLog,
  handleCancelPickLot,
  handleCreateReceiving,
  handleDeleteReceiving,
  handleListActivityLog,
  handleListPickLots,
  handleListReceiving,
  handleSavePickLot,
} from '../../server/lib.js';
import { bearerToken } from '../../server/session.js';
import { routeSlug } from '../_routing.js';
import type { ApiRequest, ApiResponse } from '../_types.js';

// Three features that never had ANY backend before this round — Activity
// Log, Batch Picking, and Goods Receiving were all browser localStorage
// only. Grouped into one [[...slug]] catch-all (rather than one file each)
// purely to stay within the Vercel Hobby plan's 12-Serverless-Function-per-
// deployment cap (see api/auth/[[...slug]].ts for the history of hitting
// that limit before) — this repo was already at 11 functions before this
// round, with no room left for three more single-purpose files.
export default async function handler(req: ApiRequest, res: ApiResponse) {
  const slug = routeSlug(req, '/api/ops');
  const token = bearerToken(req.headers.authorization);

  if (slug === 'activity-log' && req.method === 'GET') {
    const { status, body } = await handleListActivityLog(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'activity-log/append' && req.method === 'POST') {
    const { status, body } = await handleAppendActivityLog(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'batch-picking' && req.method === 'GET') {
    const { status, body } = await handleListPickLots(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'batch-picking/save' && req.method === 'POST') {
    const { status, body } = await handleSavePickLot(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'batch-picking/cancel' && req.method === 'POST') {
    const { status, body } = await handleCancelPickLot(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'receiving' && req.method === 'GET') {
    const { status, body } = await handleListReceiving(token);
    res.status(status).json(body);
    return;
  }
  if (slug === 'receiving/create' && req.method === 'POST') {
    const { status, body } = await handleCreateReceiving(token, req.body);
    res.status(status).json(body);
    return;
  }
  if (slug === 'receiving/delete' && req.method === 'POST') {
    const { status, body } = await handleDeleteReceiving(token, req.body);
    res.status(status).json(body);
    return;
  }
  res.status(404).json({ error: 'Not found' });
}
