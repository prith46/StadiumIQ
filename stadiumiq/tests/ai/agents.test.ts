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

  // 2. Malformed JSON triggers FALLBACK_RESPONSE (deep-equal for an English fan)
  it('malformed JSON response triggers FALLBACK_RESPONSE exactly', async () => {
    mockChat.mockResolvedValueOnce({
      text: 'This is not a JSON object',
      toolCalls: [],
    });

    const response = await runFanAssistant('hello', fanContext, ctx);
    expect(response).toEqual(FALLBACK_RESPONSE);
  });

  // 2b. Fallback language is taken from fanContext when known (non-English fan)
  it('fallback uses fanContext.language when the model output is malformed', async () => {
    mockChat.mockResolvedValueOnce({
      text: 'still not JSON',
      toolCalls: [],
    });

    const esFan: FanContext = { language: 'es', accessibility: false };
    const response = await runFanAssistant('hola', esFan, ctx);
    expect(response.message).toBe(FALLBACK_RESPONSE.message);
    expect(response.language).toBe('es');
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
