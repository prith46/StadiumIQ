import { useSimStore } from '../store/simStore';
import { FanContext } from '../types';

export interface AssistantRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  fanContext: FanContext;
}

export interface AssistantResponse {
  message: string;
  language: string;
  mapActions: Array<{ op: 'highlight' | 'route' | 'pin'; zoneId?: string; path?: string[] }>;
  alertLevel: 'none' | 'info' | 'warn' | 'critical';
  meta?: { tool?: string; stress?: boolean };
}

export async function sendAssistantMessage(
  req: AssistantRequest,
  options: {
    onToken?: (partial: string) => void;
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
    const simSnapshot = {
      matchClockSec: simStoreState.matchClockSec,
      density: simStoreState.density,
      gateStatus: simStoreState.gateStatus,
      incidents: simStoreState.incidents,
      routedLoad: simStoreState.routedLoad,
      sensorCounts: simStoreState.sensorCounts,
      timeline: simStoreState.timeline || [],
    };

    const response = await fetch('/api/assistant', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: req.message,
        fanContext: req.fanContext,
        simSnapshot,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const contentType = response.headers.get('Content-Type') || '';

    if (contentType.includes('text/event-stream')) {
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Response body stream reader is not available');
      }

      const decoder = new TextDecoder();
      let fullText = '';
      let finalResult: AssistantResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith('data:')) {
            const dataContent = trimmed.substring(5).trim();
            if (dataContent === '[DONE]') {
              break;
            }

            try {
              const parsed = JSON.parse(dataContent);
              if (parsed.token) {
                fullText += parsed.token;
                options.onToken?.(fullText);
              }
              if (parsed.fullResponse) {
                finalResult = parsed.fullResponse;
              }
            } catch {
              // Handle raw text chunk fallback
              fullText += dataContent;
              options.onToken?.(fullText);
            }
          }
        }
      }

      if (finalResult) {
        options.onComplete(finalResult);
      } else {
        options.onComplete({
          message: fullText,
          language: req.fanContext.language || 'en',
          mapActions: [],
          alertLevel: 'none',
        });
      }
    } else {
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
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    options.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
