import { useSimStore } from '../store/simStore';
import { useIncentiveStore } from '../store/incentiveStore';
import { TIMELINE_FRAME_STEP_SEC } from '../simulation/engine';
import { FanContext, AssistantResponse } from '../types';

export type { AssistantResponse } from '../types';

export interface AssistantRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  fanContext: FanContext;
}

// Token-efficiency caps for the conversation history sent to the server:
// only the most recent turns, each truncated, so long chats don't balloon
// the prompt.
const HISTORY_MAX_TURNS = 8;
const HISTORY_MAX_CHARS_PER_TURN = 600;

function buildHistoryPayload(req: AssistantRequest): AssistantRequest['history'] {
  const history = req.history
    .filter((m) => m.content.trim().length > 0)
    .slice(-HISTORY_MAX_TURNS)
    .map((m) => ({ role: m.role, content: m.content.slice(0, HISTORY_MAX_CHARS_PER_TURN) }));

  // The panel's message list may already contain the message being sent
  // (it is appended to the UI before the request fires) — drop it from
  // history so the model doesn't see the current question twice.
  const last = history[history.length - 1];
  if (last && last.role === 'user' && last.content === req.message.slice(0, HISTORY_MAX_CHARS_PER_TURN)) {
    history.pop();
  }
  return history;
}

export async function sendAssistantMessage(
  req: AssistantRequest,
  options: {
    onComplete: (full: AssistantResponse) => void;
    onError: (err: Error) => void;
  }
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 15000); // 15 seconds client-side timeout

  try {
    const simStoreState = useSimStore.getState();
    // Payload efficiency: the fan assistant's forecast tools only look forward
    // from the current match clock, so frames already behind us are dead
    // weight reserialized on every chat message. Keep one frame of lookback so
    // nearest-frame lookups at exactly "now" still have a bracketing frame.
    // (The copilot/debrief call sites intentionally send the full timeline —
    // root-cause tracing and debrief aggregation read history.)
    const timeline = (simStoreState.timeline || []).filter(
      (frame) => frame.atSec >= simStoreState.matchClockSec - TIMELINE_FRAME_STEP_SEC
    );
    const simSnapshot = {
      matchClockSec: simStoreState.matchClockSec,
      density: simStoreState.density,
      gateStatus: simStoreState.gateStatus,
      incidents: simStoreState.incidents,
      routedLoad: simStoreState.routedLoad,
      sensorCounts: simStoreState.sensorCounts,
      timeline,
    };

    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: req.message,
        history: buildHistoryPayload(req),
        fanContext: req.fanContext,
        simSnapshot,
        // The fan's live incentives exist only in this browser tab's store, so
        // they ride along with the request for the getIncentive tool to read.
        activeIncentives: useIncentiveStore.getState().activeIncentives,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const data = await response.json();
    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid JSON response format received');
    }

    const validated: AssistantResponse = {
      message: typeof data.message === 'string' ? data.message : '',
      language: typeof data.language === 'string' ? data.language : 'en',
      mapActions: Array.isArray(data.mapActions) ? data.mapActions : [],
      alertLevel: ['none', 'info', 'warn', 'critical'].includes(data.alertLevel)
        ? data.alertLevel
        : 'none',
      meta: data.meta,
    };

    options.onComplete(validated);
  } catch (err) {
    clearTimeout(timeoutId);
    options.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
