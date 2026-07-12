import { vi, describe, it, expect, beforeEach } from 'vitest';
import { runFanAssistant, runOrganizerCopilot, FALLBACK_RESPONSE } from '../../lib/ai/agents';
import { Zone, SimState, FanContext } from '../../lib/types';

const mockChat = vi.fn();
const mockVisionChat = vi.fn();

vi.mock('../../lib/ai/client', () => {
  return {
    createClient: () => ({
      supportsVision: true,
      chat: mockChat,
      visionChat: mockVisionChat
    }),
    AiClientError: class extends Error {},
    VisionUnsupportedError: class extends Error {}
  };
});

describe('AI Agentic Planners', () => {
  const dummyState: SimState = {
    matchClockSec: 0,
    density: {},
    gateStatus: {},
    incidents: [],
    routedLoad: {},
    sensorCounts: {},
    timeline: [],
  };

  const fanContext: FanContext = {
    language: 'en',
    accessibility: false,
  };

  const ctx = {
    simSnapshot: dummyState,
    zones: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Happy path: returns structured AssistantResponse
  it('returns valid AssistantResponse on happy path', async () => {
    mockChat.mockResolvedValueOnce({
      text: JSON.stringify({
        message: 'Hello, how can I assist you?',
        language: 'en',
        mapActions: [],
        alertLevel: 'none',
      }),
      toolCalls: [],
    });

    const response = await runFanAssistant('hello', fanContext, ctx);
    expect(response.message).toBe('Hello, how can I assist you?');
    expect(response.alertLevel).toBe('none');
  });

  // 2. Plain-text (non-JSON) model output is wrapped as the message rather than
  // discarded for the generic FALLBACK_RESPONSE — the fan still gets a real
  // reply (M2 item 7b: graceful degradation, not an error).
  it('wraps plain conversational (non-JSON) model text as the message instead of using the generic fallback', async () => {
    mockChat.mockResolvedValueOnce({
      text: 'This is not a JSON object',
      toolCalls: [],
    });

    const response = await runFanAssistant('hello', fanContext, ctx);
    expect(response.message).toBe('This is not a JSON object');
    expect(response.language).toBe('en');
    expect(response.mapActions).toEqual([]);
    expect(response.alertLevel).toBe('none');
    expect(response).not.toEqual(FALLBACK_RESPONSE);
  });

  // 2b. Fallback language is taken from fanContext when the wrapped text has no language of its own
  it('wrapped plain-text fallback uses fanContext.language (non-English fan)', async () => {
    mockChat.mockResolvedValueOnce({
      text: 'still not JSON',
      toolCalls: [],
    });

    const esFan: FanContext = { language: 'es', accessibility: false };
    const response = await runFanAssistant('hola', esFan, ctx);
    expect(response.message).toBe('still not JSON');
    expect(response.language).toBe('es');
  });

  // 2c. Truly empty model output (nothing to wrap) is the only case that still
  // uses the generic FALLBACK_RESPONSE.
  it('uses the generic FALLBACK_RESPONSE only when the model returns no text at all', async () => {
    mockChat.mockResolvedValueOnce({
      text: '',
      toolCalls: [],
    });

    const response = await runFanAssistant('hello', fanContext, ctx);
    expect(response).toEqual(FALLBACK_RESPONSE);
  });

  // 2d. JSON object missing/mistyping required fields still salvages `message`
  // and backfills sensible defaults, rather than discarding the whole reply.
  it('salvages message and backfills defaults when the JSON is missing required fields', async () => {
    mockChat.mockResolvedValueOnce({
      // language, mapActions, alertLevel are all missing — fails Zod validation
      text: JSON.stringify({ message: "Here's the nearest restroom." }),
      toolCalls: [],
    });

    const response = await runFanAssistant('where is the restroom', fanContext, ctx);
    expect(response.message).toBe("Here's the nearest restroom.");
    expect(response.language).toBe('en');
    expect(response.mapActions).toEqual([]);
    expect(response.alertLevel).toBe('none');
  });

  // 2e. A malformed mapActions entry is dropped rather than invalidating the
  // entire response.
  it('drops malformed mapActions entries but keeps the salvaged message', async () => {
    mockChat.mockResolvedValueOnce({
      text: JSON.stringify({
        message: 'Routing you now.',
        language: 'en',
        mapActions: [{ op: 'not-a-real-op' }, { op: 'highlight', zoneId: 'gate-a' }],
        alertLevel: 'none',
      }),
      toolCalls: [],
    });

    const response = await runFanAssistant('take me to the gate', fanContext, ctx);
    expect(response.message).toBe('Routing you now.');
    expect(response.mapActions).toEqual([{ op: 'highlight', zoneId: 'gate-a', path: undefined }]);
  });

  // 3. User stress keyword override forces warn/critical alertLevel and meta.stress=true
  it('forces alertLevel to warn and meta.stress=true when stress is detected', async () => {
    mockChat.mockResolvedValueOnce({
      text: JSON.stringify({
        message: 'Calm down, I am here.',
        language: 'en',
        mapActions: [],
        alertLevel: 'none',
      }),
      toolCalls: [],
    });

    // "help" triggers stress
    const response = await runFanAssistant('help me, there is an emergency', fanContext, ctx);
    expect(response.alertLevel).toBe('warn');
    expect(response.meta?.stress).toBe(true);
  });

  // 4. Multi-turn tool calling cap (max 2 round-trips)
  it('limits tool calls loop to exactly 2 round-trips then forces final text response', async () => {
    // Return tool call for first 2 calls, then final answer on 3rd call (when tools array is empty)
    mockChat.mockImplementation((messages: any, tools: any) => {
      if (tools.length > 0) {
        return Promise.resolve({
          text: null,
          toolCalls: [{ name: 'detectStress', args: { text: 'test' }, id: 'call_1' }],
        });
      } else {
        return Promise.resolve({
          text: JSON.stringify({
            message: 'Final answer after tool loops',
            language: 'en',
            mapActions: [],
            alertLevel: 'info',
          }),
          toolCalls: [],
        });
      }
    });

    const response = await runFanAssistant('trigger loop', fanContext, ctx);
    expect(response.message).toBe('Final answer after tool loops');
    expect(mockChat).toHaveBeenCalledTimes(3); // 2 tool rounds + 1 forced text round
  });

  // 5. Organizer copilot is restricted to getForecast/getPolicy/computeRoute only
  it('runOrganizerCopilot exposes only the organizer tool scope (no fan-only tools)', async () => {
    mockChat.mockResolvedValueOnce({
      text: JSON.stringify({
        message: 'Ops summary.',
        language: 'en',
        mapActions: [],
        alertLevel: 'none',
      }),
      toolCalls: [],
    });

    await runOrganizerCopilot('status of north gate', ctx);

    // Second positional arg of client.chat is the tool schema array actually offered.
    const toolsOffered = mockChat.mock.calls[0][1] as Array<{ name: string }>;
    const names = toolsOffered.map((t) => t.name).sort();
    expect(names).toEqual(['computeRoute', 'getForecast', 'getPolicy']);
    // fan-only tools must NOT be exposed to the organizer copilot
    expect(names).not.toContain('detectStress');
    expect(names).not.toContain('findAmenity');
    expect(names).not.toContain('getIncentive');
  });
});
