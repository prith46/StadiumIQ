import { describe, it, expect, beforeEach } from 'vitest';
import { readJsonBody } from '../../lib/server/readJsonBody';
import { rateLimitKey, allowRequest, resetRateLimits } from '../../lib/server/rateLimit';

describe('readJsonBody', () => {
  it('parses a JSON body within the cap', async () => {
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ a: 1 }),
    });
    const res = await readJsonBody(req, 1024);
    expect(res).toEqual({ ok: true, body: { a: 1 } });
  });

  it('rejects a body over the cap with too_large', async () => {
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body: '"' + 'a'.repeat(2048) + '"',
    });
    const res = await readJsonBody(req, 1024);
    expect(res).toEqual({ ok: false, reason: 'too_large' });
  });

  it('rejects malformed JSON with invalid_json', async () => {
    const req = new Request('http://localhost/x', {
      method: 'POST',
      body: '{not json',
    });
    const res = await readJsonBody(req, 1024);
    expect(res).toEqual({ ok: false, reason: 'invalid_json' });
  });
});

describe('rate limiting trust model', () => {
  beforeEach(() => {
    resetRateLimits();
  });

  it('does NOT key on client-supplied x-forwarded-for (no bucket minting via header rotation)', () => {
    const mk = (ip: string) =>
      new Request('http://localhost/x', { headers: { 'x-forwarded-for': ip } });
    // Rotating the spoofable header must land every caller in the same bucket.
    expect(rateLimitKey('r', mk('1.1.1.1'))).toBe('r:shared');
    expect(rateLimitKey('r', mk('2.2.2.2'))).toBe('r:shared');
  });

  it('keys on the platform-set x-vercel-forwarded-for when present', () => {
    const req = new Request('http://localhost/x', {
      headers: { 'x-vercel-forwarded-for': '3.3.3.3' },
    });
    expect(rateLimitKey('r', req)).toBe('r:3.3.3.3');
  });

  it('enforces the global per-route backstop even across distinct client IPs', () => {
    let allowed = 0;
    for (let i = 0; i < 400; i++) {
      const req = new Request('http://localhost/x', {
        headers: { 'x-vercel-forwarded-for': `10.${Math.floor(i / 200)}.${Math.floor(i / 10) % 20}.${i % 10}` },
      });
      if (allowRequest('budget-route', req)) allowed++;
    }
    // Per-client buckets never fill (unique IPs), so only the shared route
    // budget can stop the flood — and it must.
    expect(allowed).toBe(300);
  });
});
