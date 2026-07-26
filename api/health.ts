import { handleHealth } from '../server/lib.js';
import type { ApiRequest, ApiResponse } from './_types.js';

export default function handler(_req: ApiRequest, res: ApiResponse) {
  const { status, body } = handleHealth();
  res.status(status).json(body);
}
