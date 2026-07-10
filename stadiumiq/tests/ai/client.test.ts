import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createClient, AiClientError, VisionUnsupportedError } from '../../lib/ai/client';
import { reevaluateAiEnv } from '../../lib/ai/env';

describe('AI Client Adapter', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    reevaluateAiEnv();
    vi.restoreAllMocks();
  });

  it('selects Gemini client based on environment configuration', () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_MODEL = 'gemini-2.5-flash';
    process.env.LLM_API_KEY = 'test-gemini-key';
    reevaluateAiEnv();

    const client = createClient();
    expect(client.supportsVision).toBe(true);
  });

  it('selects Groq client based on environment configuration', () => {
    process.env.LLM_PROVIDER = 'groq';
    process.env.LLM_MODEL = 'llama-3.3-70b-versatile';
    process.env.LLM_API_KEY = 'test-groq-key';
    reevaluateAiEnv();

    const client = createClient();
    expect(client.supportsVision).toBe(false);
  });

  it('groq visionChat throws VisionUnsupportedError', async () => {
    process.env.LLM_PROVIDER = 'groq';
    process.env.LLM_MODEL = 'llama-3.3-70b-versatile';
    process.env.LLM_API_KEY = 'test-groq-key';
    reevaluateAiEnv();

    const client = createClient();
    await expect(client.visionChat([], 'base64', 'image/png'))
      .rejects.toThrow(VisionUnsupportedError);
  });

  it('performs exactly one retry on 500 error or timeout then throws sanitized AiClientError', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_MODEL = 'gemini-2.5-flash';
    process.env.LLM_API_KEY = 'test-gemini-key';
    process.env.LLM_TIMEOUT_MS = '100';
    reevaluateAiEnv();

    // Mock fetch to fail with 503 Service Unavailable
    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'Raw secret error message' } }), { status: 503 }))
    );
    vi.stubGlobal('fetch', fetchSpy);

    const client = createClient();
    
    await expect(client.chat([{ role: 'user', content: 'hello' }], []))
      .rejects.toThrow(AiClientError);

    // Should make 2 attempts total (1 original + 1 retry)
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Verify raw secret error message is sanitized/hidden in error message
    try {
      await client.chat([{ role: 'user', content: 'hello' }], []);
    } catch (err: any) {
      expect(err.message).not.toContain('Raw secret error message');
      expect(err.message).toContain('Gemini communication failure');
    }
  });

  it('performs ZERO retries on a 4xx client error', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_MODEL = 'gemini-2.5-flash';
    process.env.LLM_API_KEY = 'test-gemini-key';
    reevaluateAiEnv();

    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }))
    );
    vi.stubGlobal('fetch', fetchSpy);

    const client = createClient();
    await expect(client.chat([{ role: 'user', content: 'hi' }], [])).rejects.toThrow(AiClientError);
    // 4xx must not be retried
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
