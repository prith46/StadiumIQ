/**
 * lib/server/guardRequest.ts
 *
 * Shared request guard for the LLM-backed API routes. Every route repeats the
 * same front-door sequence before it does any real work:
 *   1. rate-limit the caller (paid provider calls sit behind each route),
 *   2. read the JSON body under a hard byte cap (streaming, never fully
 *      buffered — see readJsonBody),
 *   3. strict-zod-parse the body, never leaking parser internals to the client.
 *
 * This helper centralises those three checks (and their exact status codes and
 * client-safe error messages) so every route enforces them identically. It
 * intentionally does NOT wrap the route's own success/failure handling: each
 * route keeps its own try/catch and fallback, which differ per route.
 */
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { allowRequest } from './rateLimit';
import { readJsonBody } from './readJsonBody';

export type GuardResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse };

export interface GuardOptions<T extends z.ZodTypeAny> {
  /** Rate-limit bucket name for this route (also the per-route global budget key). */
  route: string;
  /** Hard body cap in bytes, enforced while streaming. */
  maxBytes: number;
  /** Strict zod schema the parsed body must satisfy. */
  schema: T;
}

/**
 * Runs the rate-limit → body-cap → strict-zod-parse sequence. On any failure
 * returns `{ ok: false, response }` with the appropriate status (429 / 413 /
 * 400) and a client-safe error message; on success returns the validated,
 * strongly-typed data. Behaviour is identical to the inline sequence each
 * route previously carried.
 */
export async function guardRequest<T extends z.ZodTypeAny>(
  req: Request,
  { route, maxBytes, schema }: GuardOptions<T>
): Promise<GuardResult<z.infer<T>>> {
  if (!allowRequest(route, req)) {
    return { ok: false, response: NextResponse.json({ error: 'Too many requests' }, { status: 429 }) };
  }

  const read = await readJsonBody(req, maxBytes);
  if (!read.ok) {
    return {
      ok: false,
      response:
        read.reason === 'too_large'
          ? NextResponse.json({ error: 'Payload too large' }, { status: 413 })
          : NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 }),
    };
  }

  const result = schema.safeParse(read.body);
  if (!result.success) {
    // Never surface raw zod error internals to the client (§8).
    return { ok: false, response: NextResponse.json({ error: 'Invalid request payload' }, { status: 400 }) };
  }

  return { ok: true, data: result.data };
}
