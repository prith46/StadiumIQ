# M2 Conversational AI Assistant

This document outlines the architecture, data structures, streaming support, map action integration, and security controls for the Conversational AI Assistant component.

---

## 1. Goal & Component Architecture
The `<AssistantPanel>` component serves as the primary conversational interface for fans inside MetLife Stadium.
- **Persistent Access**: Rendered as a right-hand sidebar once onboarding is completed.
- **Grounded Responses**: The assistant uses current context (such as fan location, accessibility preferences, and stadium heatmaps) to answer questions, highlight zones, draw routes, and drop pins.
- **Entry Points**: Accommodates modular stubs for voice requests, ticket scans, and vision-based updates.

---

## 2. API Contract
All requests are routed strictly through `/api/assistant` via the API client wrapper in `lib/assistant/client.ts`.

### Outbound Request (`AssistantRequest`)
```ts
interface AssistantRequest {
  message: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  fanContext: FanContext; // from lib/types.ts
}
```
*Note: The client wrapper compiles the current `simSnapshot: SimState` directly from `useSimStore.getState()` on-the-fly to satisfy backend validation schemas.*

### Inbound Response (`AssistantResponse`)
```ts
interface AssistantResponse {
  message: string;
  language: string;
  mapActions: Array<{ op: 'highlight' | 'route' | 'pin'; zoneId?: string; path?: string[] }>;
  alertLevel: 'none' | 'info' | 'warn' | 'critical';
  meta?: { tool?: string; stress?: boolean };
}
```

---

## 3. Streaming vs. Non-Streaming Handling
The API client parses the response dynamically:
1. **JSON Payload**: If `Content-Type` is JSON, the response is parsed at once and triggers the `onComplete` callback directly.
2. **Server-Sent Events (SSE)**: If `Content-Type` is `text/event-stream`, the client decodes chunks line-by-line:
   - Emits incremental text outputs to the UI via `onToken` to render word-by-word streaming.
   - Parses the final accumulated payload to run `onComplete`.
   - Client-side timeout of **15 seconds** triggers an automatic abort, rendering an inline retry bubble rather than hanging infinitely.

---

## 4. Map Action Dispatch Flow
Assistant responses may coordinate map actions via the `mapActions[]` payload. The dispatcher in `lib/assistant/mapActionDispatcher.ts` intercepts these operations:
- Maps actions directly to the imperative ref handles (`highlightZone`, `drawRoute`, `dropPin`) provided by the M4 `<StadiumMap>`.
- Wraps each action execution in an individual try/catch statement to prevent single action errors (e.g. invalid sector IDs) from halting downstream instructions.
- Silently no-ops with a `console.warn` if the map is not mounted in the current view, preventing crashes.

---

## 5. Security & Invariant Rules
- **No `dangerouslySetInnerHTML`**: React renders text bubbles as untrusted strings, sanitizing user inputs by default. A custom bold/italic parser compiles markdown inline safely without HTML injections.
- **Single Choke Point**: All fetches to `/api/assistant` must pass through `lib/assistant/client.ts` to ensure central request normalization.
- **Model/Provider Configuration**: **MUST RESIDE IN `.env` FILES ONLY**. No provider names (e.g. OpenAI, Anthropic, Google) or model IDs (e.g. GPT-4, Gemini) may be typed into client-side source code or test fixtures. This policy is verified automatically via a recursive grep checker test in `client.test.ts`.
