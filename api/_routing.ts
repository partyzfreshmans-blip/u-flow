import type { ApiRequest } from './_types.js';

/**
 * Logs a request that fell through every route match in a catch-all
 * handler's if-chain, right before it returns its generic 404. Cheap
 * insurance against the exact failure mode this project has hit before
 * (see routeSlug's own comment) — if req.url is ever shaped differently
 * than expected in some deploy/runtime, this shows up immediately in
 * Vercel's function logs (Project → Deployments → a deployment → Functions)
 * instead of leaving "HTTP 404" as the only clue on the client side.
 */
export function logUnmatchedRoute(handlerName: string, req: ApiRequest, slug: string): void {
  console.error(`[${handlerName}] no route matched — method=${req.method} url=${req.url ?? '(none)'} parsedSlug=${JSON.stringify(slug)}`);
}

/**
 * Derives the sub-path segment(s) after a fixed prefix straight from the
 * request's own URL, e.g. routeSlug(req, '/api/auth') returns 'login' for a
 * request to /api/auth/login, and '' for a request to /api/auth itself.
 *
 * Deliberately NOT based on req.query.slug (the [[...slug]] optional
 * catch-all's usual param): in production, every one of this project's
 * catch-all API routes (auth, bookings, users) was matching only the
 * zero-segment base path and 404ing on every real sub-route
 * (/api/auth/login, /api/bookings/create, /api/users/update, ...) — because
 * an *undefined* req.query.slug and an *actually-empty* one both coerce to
 * the same '' here, a broken query param was silently indistinguishable
 * from a genuinely bare request. req.url is a plain string straight off the
 * raw Node request; parsing it directly has no such ambiguity and works
 * the same regardless of how (or whether) the platform's own dynamic-route
 * query population behaves for this project's non-framework Functions setup.
 */
export function routeSlug(req: ApiRequest, prefix: string): string {
  const pathname = (req.url ?? '').split('?')[0];
  const idx = pathname.indexOf(prefix);
  const rest = idx === -1 ? pathname : pathname.slice(idx + prefix.length);
  return rest.replace(/^\/+|\/+$/g, '');
}
