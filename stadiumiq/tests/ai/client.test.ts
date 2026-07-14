import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createClient, AiClientError, VisionUnsupportedError } from '../../lib/ai/client';
import { reevaluateAiEnv } from '../../lib/ai/env';

// Neutral placeholder model id: provider selection keys off LLM_PROVIDER, not
// the model string, so no real provider/model name needs to appear in fixtures.
// (See the `no hardcoded provider/model ids in shipped source` guard below.)
const TEST_MODEL_ID = 'test-model';

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
    process.env.LLM_MODEL = TEST_MODEL_ID;
    process.env.LLM_API_KEY = 'test-gemini-key';
    reevaluateAiEnv();

    const client = createClient();
    expect(client.supportsVision).toBe(true);
  });

  it('selects Groq client based on environment configuration', () => {
    process.env.LLM_PROVIDER = 'groq';
    process.env.LLM_MODEL = TEST_MODEL_ID;
    process.env.LLM_API_KEY = 'test-groq-key';
    reevaluateAiEnv();

    const client = createClient();
    expect(client.supportsVision).toBe(false);
  });

  it('groq visionChat throws VisionUnsupportedError', async () => {
    process.env.LLM_PROVIDER = 'groq';
    process.env.LLM_MODEL = TEST_MODEL_ID;
    process.env.LLM_API_KEY = 'test-groq-key';
    reevaluateAiEnv();

    const client = createClient();
    await expect(client.visionChat([], 'base64', 'image/png'))
      .rejects.toThrow(VisionUnsupportedError);
  });

  it('performs exactly one retry on 500 error or timeout then throws sanitized AiClientError', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_MODEL = TEST_MODEL_ID;
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

  it('captures a Gemini functionCall thoughtSignature and replays it on the functionCall part in history', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_MODEL = TEST_MODEL_ID;
    process.env.LLM_API_KEY = 'test-gemini-key';
    reevaluateAiEnv();

    // Turn 1: Gemini returns a functionCall part carrying a thoughtSignature.
    const geminiFunctionCallResponse = {
      candidates: [
        {
          content: {
            parts: [
              {
                functionCall: { name: 'findAmenity', args: { type: 'restroom' } },
                thoughtSignature: 'SIG_ABC123',
              },
            ],
          },
        },
      ],
    };

    const fetchSpy = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(geminiFunctionCallResponse), { status: 200 }))
    );
    vi.stubGlobal('fetch', fetchSpy);

    const client = createClient();

    const result = await client.chat([{ role: 'user', content: 'nearest restroom?' }], [
      { name: 'findAmenity', description: 'finds amenities', parameters: {} },
    ]);

    // (a) The signature must be captured off the response part.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('findAmenity');
    expect(result.toolCalls[0].thoughtSignature).toBe('SIG_ABC123');

    // Turn 2: replay the assistant tool-call turn as history (exactly as
    // runPlanningLoop does — JSON-serialised toolCalls) and confirm the request
    // body sent to Gemini re-attaches thoughtSignature on the functionCall part.
    fetchSpy.mockClear();
    fetchSpy.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 }))
    );

    await client.chat(
      [
        { role: 'user', content: 'nearest restroom?' },
        { role: 'assistant', content: JSON.stringify(result.toolCalls) },
        { role: 'tool', content: JSON.stringify([{ label: 'Restroom 1' }]), toolCallId: 'findAmenity' },
      ],
      []
    );

    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as any).body as string);
    const modelTurn = sentBody.contents.find((c: any) => c.role === 'model');
    expect(modelTurn).toBeDefined();
    const fcPart = modelTurn.parts.find((p: any) => p.functionCall);
    expect(fcPart.functionCall.name).toBe('findAmenity');
    // The critical assertion: the signature is echoed back on the same part.
    expect(fcPart.thoughtSignature).toBe('SIG_ABC123');
  });

  it('omits thoughtSignature on the functionCall part when the model turn has none (Groq-style)', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_MODEL = TEST_MODEL_ID;
    process.env.LLM_API_KEY = 'test-gemini-key';
    reevaluateAiEnv();

    const fetchSpy = vi.fn().mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 }))
    );
    vi.stubGlobal('fetch', fetchSpy);

    const client = createClient();
    await client.chat(
      [
        { role: 'user', content: 'hi' },
        // Tool call with no thoughtSignature (e.g. a Groq-originated call).
        { role: 'assistant', content: JSON.stringify([{ name: 'findAmenity', args: {}, id: 'findAmenity' }]) },
        { role: 'tool', content: '[]', toolCallId: 'findAmenity' },
      ],
      []
    );

    const sentBody = JSON.parse((fetchSpy.mock.calls[0][1] as any).body as string);
    const modelTurn = sentBody.contents.find((c: any) => c.role === 'model');
    const fcPart = modelTurn.parts.find((p: any) => p.functionCall);
    // No signature present → the key must be absent (not undefined/null), so we
    // never send an empty thought_signature that Gemini would reject.
    expect('thoughtSignature' in fcPart).toBe(false);
  });

  it('performs ZERO retries on a 4xx client error', async () => {
    process.env.LLM_PROVIDER = 'gemini';
    process.env.LLM_MODEL = TEST_MODEL_ID;
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

/**
 * Firm invariant guard (docs/M2-assistant.md §Model/Provider Configuration):
 * provider/model ids live ONLY in `.env`, never hardcoded in shipped source.
 * This recursively scans lib/, app/, and components/ (excluding test files) and
 * fails if any provider/model id literal is present — the automated grep-checker
 * the docs reference.
 */
describe('provider-agnostic invariant', () => {
  // Matches a model-family name immediately followed by a version digit, e.g.
  // gemini-2.5-flash, gpt-4, claude-3, llama-3.3-70b. Requiring a trailing digit
  // avoids false positives on tokens like "gemini-api" in doc URLs.
  const MODEL_ID_PATTERN = /\b(gemini|gpt|claude|llama|mixtral|gemma|qwen|deepseek|mistral|palm|command)-[0-9]/i;
  const SOURCE_ROOTS = ['lib', 'app', 'components'];
  const projectRoot = process.cwd();

  function collectSourceFiles(dir: string, acc: string[]): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectSourceFiles(full, acc);
      } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) {
        acc.push(full);
      }
    }
    return acc;
  }

  it('has no hardcoded provider/model id literals in lib/, app/, or components/', () => {
    const offenders: string[] = [];
    for (const root of SOURCE_ROOTS) {
      const rootDir = path.join(projectRoot, root);
      if (!fs.existsSync(rootDir)) continue;
      for (const file of collectSourceFiles(rootDir, [])) {
        fs.readFileSync(file, 'utf-8')
          .split('\n')
          .forEach((line, idx) => {
            if (MODEL_ID_PATTERN.test(line)) {
              offenders.push(`${path.relative(projectRoot, file)}:${idx + 1}: ${line.trim()}`);
            }
          });
      }
    }
    expect(
      offenders,
      `Hardcoded provider/model ids must live only in .env — found:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
