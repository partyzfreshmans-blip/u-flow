import type { IncomingMessage, ServerResponse } from 'node:http';

// Vercel's Node.js runtime hands each function a plain Node request/response
// with a few convenience properties layered on — this is just enough typing
// for that shape without pulling in @vercel/node as a dependency.

export interface ApiRequest extends IncomingMessage {
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
  body: unknown;
}

export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
}
