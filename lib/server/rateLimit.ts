/**
 * lib/server/rateLimit.ts
 *
 * Minimal in-memory fixed-window rate limiter for the LLM-backed API routes.
 * Every one of those routes triggers a paid provider call, so an unthrottled
 * client could rack up cost or exhaust the provider quota. Per-instance
 * memory is the right scope for this single-process demo deployment; a
 * multi-instance deployment would swap this for a shared store.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

// LIMITATION: this Map is process-local, so the limiter is per-instance only.
// Correct for the documented single-process demo deployment; a multi-instance
// or serverless deployment would need a shared store (e.g. Redis) for the
// budget to hold globally. Kept in-memory intentionally for the hackathon scope.
const buckets = new Map<string, Bucket>();

const DEFAULT_LIMIT = 30;
const DEFAULT_WINDOW_MS = 60_000;

// Backstop budget shared by ALL callers of a route per window. Bounds total
// provider spend even if many distinct (real) client IPs hit the route at
// once — and makes header-forging strictly pointless: minting fresh per-IP
// buckets can never unlock more than this aggregate budget.
const GLOBAL_ROUTE_LIMIT = 300;

/**
 * Returns true when the caller identified by `key` is within its budget of
 * `limit` requests per `windowMs`, and records this request against it.
 */
export function checkRateLimit(
  key: string,
  limit: number = DEFAULT_LIMIT,
  windowMs: number = DEFAULT_WINDOW_MS
): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    // Opportunistic cleanup so the map can't grow unboundedly under
    // many distinct keys.
    if (buckets.size > 10_000) {
      for (const [k, b] of buckets) {
        if (now >= b.resetAt) buckets.delete(k);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  bucket.count++;
  return bucket.count <= limit;
}

/**
 * Rate-limit key for a route handler request: route name + client IP from a
 * TRUSTED header only.
 *
 * Trust model (documented deployment target: Vercel):
 * - `x-vercel-forwarded-for` is set by Vercel's proxy layer; incoming
 *   `x-vercel-*` headers from clients are stripped by the platform, and
 *   functions are only reachable through that proxy — so its value cannot be
 *   forged by the caller.
 * - On Google Cloud Run, `x-cloud-trace-context` is always injected by the
 *   platform. When that header is present, `x-forwarded-for` is also set by
 *   Cloud Run's load balancer (client-supplied values are stripped), making
 *   its first entry trustworthy as a per-client key.
 * - A bare `x-forwarded-for` with NO Cloud Run trace context is NOT trusted:
 *   on a directly-exposed `next start` the caller sets it freely, and honouring
 *   it would let an attacker rotate the header to mint fresh buckets and bypass
 *   the per-client cap entirely.
 * - Without a trusted client-IP signal, every caller shares one bucket: the
 *   limit degrades to a stricter shared cap instead of becoming bypassable.
 */
export function rateLimitKey(route: string, req: Request): string {
  // Vercel: x-vercel-forwarded-for is injected by Vercel's edge proxy.
  // Cloud Run: x-cloud-trace-context is always present; x-forwarded-for is
  //   then trustworthy (Cloud Run's LB strips & re-adds it).
  // Bare next start: neither trusted signal is present → fall back to 'shared'.
  const isCloudRun = req.headers.get('x-cloud-trace-context') !== null;
  const trustedIp =
    req.headers.get('x-vercel-forwarded-for') ??
    (isCloudRun ? req.headers.get('x-forwarded-for') : null);
  const ip = trustedIp ? trustedIp.split(',')[0].trim() : 'shared';
  return `${route}:${ip}`;
}

/**
 * Single entry point for route handlers: enforces the per-client limit AND a
 * global per-route backstop budget. Both must pass.
 */
export function allowRequest(route: string, req: Request): boolean {
  const perClientOk = checkRateLimit(rateLimitKey(route, req));
  const globalOk = checkRateLimit(`${route}:__route_total__`, GLOBAL_ROUTE_LIMIT);
  return perClientOk && globalOk;
}

/** Test hook: clear all rate-limit state. */
export function resetRateLimits(): void {
  buckets.clear();
}
