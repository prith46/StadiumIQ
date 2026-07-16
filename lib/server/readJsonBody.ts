/**
 * lib/server/readJsonBody.ts
 *
 * Reads and parses a JSON request body with a hard byte cap enforced WHILE
 * streaming: the read is cancelled the moment the cap is exceeded, so an
 * oversized body is never fully buffered, JSON-parsed, or regex-scanned.
 * Every API route reads its body through this guard — `req.json()` alone
 * imposes no size limit in a route handler.
 */

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: 'too_large' | 'invalid_json' };

export async function readJsonBody(req: Request, maxBytes: number): Promise<JsonBodyResult> {
  // Fast reject when the client declares an oversized payload up front.
  const contentLength = req.headers.get('content-length');
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { ok: false, reason: 'too_large' };
    }
  }

  if (!req.body) {
    return { ok: false, reason: 'invalid_json' };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > maxBytes) {
          // Stop pulling bytes immediately — do not buffer the rest.
          await reader.cancel();
          return { ok: false, reason: 'too_large' };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(combined)) };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}
