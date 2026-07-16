# Provider-Agnostic AI Layer Documentation (F4)

The **Provider-Agnostic AI Layer** manages all natural language interactions in StadiumIQ. It handles user requests by reasoning over the stadium graph (F2) and live state (F3) via tools, returning structured JSON response payloads, sanitizing inputs against injection attacks, and falling back gracefully during timeouts or service outages.

---

## Configuration & Swapping Providers

All AI configuration is loaded strictly from environment variables. Swapping the backend LLM provider requires editing **only** the `.env` configuration file — no codebase changes are needed.

Configuration is defined once in `lib/ai/env.ts` (the single source of truth; `.env.example` documents the contract). The zod schema is evaluated **once at module load** into a cached object; `AI_ENV` is a thin `Proxy` over that cache. The Proxy does not re-read `process.env` or re-validate on each access — it only **defers throwing** a validation failure to first property access, so route handlers can catch a misconfigured environment at request time and return the localized `FALLBACK_RESPONSE` instead of crashing at import. Raw zod validation errors are never surfaced to clients. (`reevaluateAiEnv()` exists solely to let tests re-parse after mutating `process.env`.)

The following variables are parsed and validated:

| Env Variable Name | Type | Valid Options | Description |
| :--- | :--- | :--- | :--- |
| `LLM_PROVIDER` | Enum | `gemini` \| `groq` | Selects which adapter driver to invoke. |
| `LLM_MODEL` | String | e.g. `gemini-2.5-flash`, `llama-3.3-70b-versatile` | Passed verbatim to the selected provider API. |
| `LLM_API_KEY` | String | e.g. `AIzaSy...` \| `gsk_...` | Access token for the service endpoint. |
| `LLM_TIMEOUT_MS` | Number | Default: `8000` | Real-world ms timeout threshold before aborting. |

---

## Tool Contracts

The AI is strictly grounded in deterministic tool execution and cannot "hallucinate" numbers, routes, or forecasts.

| Tool Name | Arguments | Return Shape | Status | Blocked By / Unblocked By |
| :--- | :--- | :--- | :--- | :--- |
| `computeRoute` | `fromZoneId: string`<br>`toZoneId: string`<br>`accessibility?: boolean` | `{ path: string[], etaSec: number, reason: { crowdedZones: string[], avoidedGates: string[] } }` | `TODO Stub` | Blocked by M3 (Routing Engine) |
| `getForecast` | `zoneId: string`<br>`timeSec: number` | `{ predictedDensity: Record<string, number>, peakCrushAtSec: number \| null }` | `TODO Stub` | Blocked by M7 (Predictive Forecasts) |
| `getIncentive` | `fromZoneId: string` | `{ id: string, fromZone: string, toZone: string, reward: string, qrPayload: string, expiresAt: number }` | `TODO Stub` | Blocked by M9 (Detour Incentives) |
| `findAmenity` | `fromZoneId: string`<br>`type: PoiType`<br>`nearestOpen?: boolean` | `Poi[]` (up to 3 closest matches, sorted using BFS graph search) | **Fully Implemented** | None |
| `detectStress` | `text: string` | `{ stress: boolean, matchedSignals: string[] }` | **Fully Implemented** | None |
| `getPolicy` | `query: string` | `{ section: string, content: string }[]` (RAG matches) | **Fully Implemented** | None |

---

## The `AssistantResponse` Contract

All route responses returned by the assistant, vision parser, and copilot endpoints strictly conform to this JSON schema:

```json
{
  "message": "Direct text communication to the user/organizer in their language",
  "language": "Target language code (e.g. 'en', 'es', 'pt', 'ja', 'ko')",
  "mapActions": [
    {
      "op": "highlight" | "route" | "pin",
      "zoneId": "optional-zone-id",
      "path": ["optional", "route", "zone", "nodes"]
    }
  ],
  "alertLevel": "none" | "info" | "warn" | "critical",
  "meta": {
    "tool": "optional-calling-tool-name",
    "stress": true | false
  }
}
```

---

## Prompt Injection Defense

To prevent users from hijacking the LLM prompt instructions (e.g. instructing it to "ignore previous instructions"), the system implements a strict multi-layer defense:

1. **Tag Encapsulation**: User inputs are wrapped in `<user_message>` and `</user_message>` tags.
2. **System Prompt Guardrails**: The system instructions mandate that content within these tags is untrusted user content and must never be interpreted as commands.
3. **Escaping Prevention**: Prior to wrapping, the agent layer (`runFanAssistant` / `runOrganizerCopilot` in `lib/ai/agents.ts`) sanitizes any user text containing the `<user_message>` / `</user_message>` delimiters, substituting them with `[filtered]`. The filter is **case-insensitive** (`/…/gi`), so variants like `</USER_MESSAGE>` are also caught. This eliminates literal delimiter-escaping exploits. Note: whitespace-split or model-reconstructed variants of the tag are inherent to free text and out of scope; the system-prompt guardrail (layer 2) is the defense-in-depth for those.

---

## RAG-Lite Knowledge Retrieval

Grounding retrieval runs fully in-memory and executes deterministically without vector databases or external network dependencies:

1. **Chunking**: During module load, `data/knowledge.md` is parsed by `##` Markdown headings into `{ section, content }` chunks and cached.
2. **Retrieval**: Query strings are lowercased and split into tokens. Chunks are scored based on the number of whole-word keyword overlaps.
3. **Tie-Breaking**: Ties in overlap scoring are resolved by the chunk's original index order, ensuring 100% deterministic outputs.

---

## Fallback & Resilience

- **Timeout Abort**: Request requests are bound to a short timeout controlled by `AbortController`.
- **Automatic Retry**: If a request encounters a network dropout or an HTTP 5xx error, it automatically retries **exactly once** before raising an error.
- **Client Fallback**: If an adapter error, JSON parsing error, or environment parsing error is caught, the API returns a safe, localized fallback response payload (`FALLBACK_RESPONSE`) with an HTTP 200 status code rather than crashing or returning HTTP 500.
- **Input Validation**: HTTP 400 Bad Request is returned before contacting the AI models if input queries exceed 2000 characters or contain malformed JSON properties.
