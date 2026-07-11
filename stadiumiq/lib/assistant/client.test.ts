import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sendAssistantMessage, AssistantRequest } from './client';
import { useSimStore } from '../store/simStore';
import * as fs from 'fs';
import * as path from 'path';

describe('Assistant client API requester', () => {
  const reqPayload: AssistantRequest = {
    message: 'Hello Assistant',
    history: [],
    fanContext: {
      language: 'en',
      location: 'sec-214',
      accessibility: false,
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    // Initialize simStore state
    useSimStore.setState({
      matchClockSec: 120,
      density: { 'sec-214': 0.8 },
      gateStatus: { 'gate-a': 'open' },
      incidents: [],
      routedLoad: {},
      sensorCounts: { 'sec-214': 5 },
      timeline: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('posts correct payload including simSnapshot to /api/assistant', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        message: 'Hello Fan',
        language: 'en',
        mapActions: [],
        alertLevel: 'none',
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const onComplete = vi.fn();
    const onError = vi.fn();

    await sendAssistantMessage(reqPayload, { onComplete, onError });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/assistant', expect.any(Object));

    const fetchArgs = fetchSpy.mock.calls[0][1];
    const parsedBody = JSON.parse(fetchArgs.body);

    expect(parsedBody.message).toBe('Hello Assistant');
    expect(parsedBody.fanContext).toEqual(reqPayload.fanContext);
    expect(parsedBody.simSnapshot).toEqual({
      matchClockSec: 120,
      density: { 'sec-214': 0.8 },
      gateStatus: { 'gate-a': 'open' },
      incidents: [],
      routedLoad: {},
      sensorCounts: { 'sec-214': 5 },
      timeline: [],
    });
    expect(onComplete).toHaveBeenCalledWith({
      message: 'Hello Fan',
      language: 'en',
      mapActions: [],
      alertLevel: 'none',
      meta: undefined,
    });
  });

  it('non-streaming: handles success JSON payload and triggers onComplete', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        message: 'Response Text',
        language: 'en',
        mapActions: [{ op: 'highlight', zoneId: 'sec-214' }],
        alertLevel: 'warn',
        meta: { tool: 'nav' },
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const onComplete = vi.fn();
    const onError = vi.fn();

    await sendAssistantMessage(reqPayload, { onComplete, onError });

    expect(onComplete).toHaveBeenCalledWith({
      message: 'Response Text',
      language: 'en',
      mapActions: [{ op: 'highlight', zoneId: 'sec-214' }],
      alertLevel: 'warn',
      meta: { tool: 'nav' },
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('streaming EventSource: triggers onToken and onComplete', async () => {
    // Mock ReadableStream reader for text/event-stream
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"token": "Hel"}\n',
      'data: {"token": "lo "}\n',
      'data: {"token": "World"}\n',
      'data: {"fullResponse": {"message": "Hello World", "language": "en", "mapActions": [], "alertLevel": "none"}}\n',
      'data: [DONE]\n',
    ];

    let chunkIdx = 0;
    const mockReader = {
      read: async () => {
        if (chunkIdx >= chunks.length) {
          return { done: true, value: undefined };
        }
        const val = encoder.encode(chunks[chunkIdx++]);
        return { done: false, value: val };
      },
    };

    const mockStream = {
      getReader: () => mockReader,
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Type': 'text/event-stream' }),
      body: mockStream,
    });
    vi.stubGlobal('fetch', fetchSpy);

    const onToken = vi.fn();
    const onComplete = vi.fn();
    const onError = vi.fn();

    await sendAssistantMessage(reqPayload, { onToken, onComplete, onError });

    expect(onToken).toHaveBeenCalledTimes(3);
    expect(onToken).toHaveBeenNthCalledWith(1, 'Hel');
    expect(onToken).toHaveBeenNthCalledWith(2, 'Hello ');
    expect(onToken).toHaveBeenNthCalledWith(3, 'Hello World');

    expect(onComplete).toHaveBeenCalledWith({
      message: 'Hello World',
      language: 'en',
      mapActions: [],
      alertLevel: 'none',
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('handles non-2xx failures and invokes onError', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal('fetch', fetchSpy);

    const onComplete = vi.fn();
    const onError = vi.fn();

    await sendAssistantMessage(reqPayload, { onComplete, onError });

    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toContain('Server returned status 500');
  });

  it('triggers 15 seconds request timeout and throws abort error', async () => {
    const fetchSpy = vi.fn().mockImplementation((url, init) => {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          reject(new Error('The user aborted a request.'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const onComplete = vi.fn();
    const onError = vi.fn();

    const promise = sendAssistantMessage(reqPayload, { onComplete, onError });

    // Advance Vitest timers by 15000ms
    vi.advanceTimersByTime(15000);

    await promise;

    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(onError.mock.calls[0][0].message).toContain('The user aborted a request.');
  });
});

describe('Security & Environment Rules: No Hardcoded Models/Providers', () => {
  it('ensures no provider or model names are hardcoded in the client assistant source files', () => {
    // Model and provider names that must never be hardcoded in client source files
    const BANNED_STRINGS = [
      'gpt',
      'claude',
      'gemini',
      'openai',
      'anthropic',
      'google',
      'llama',
      'deepseek',
    ];

    const checkDir = (dirPath: string) => {
      if (!fs.existsSync(dirPath)) return;
      const files = fs.readdirSync(dirPath);
      for (const file of files) {
        const fullPath = path.join(dirPath, file);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          checkDir(fullPath);
        } else if (file.endsWith('.ts') || file.endsWith('.tsx')) {
          const content = fs.readFileSync(fullPath, 'utf8').toLowerCase();
          for (const banned of BANNED_STRINGS) {
            // Exclude this test file itself from the check to avoid false positives on BANNED_STRINGS definition
            if (content.includes(banned) && !file.includes('client.test.ts')) {
              throw new Error(`Source file ${fullPath} contains banned string: "${banned}"`);
            }
          }
        }
      }
    };

    const libPath = path.resolve(__dirname, '../../lib/assistant');
    const compPath = path.resolve(__dirname, '../../components/assistant');
    checkDir(libPath);
    checkDir(compPath);
  });
});
