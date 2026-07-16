# StadiumIQ

## Overview

StadiumIQ is a GenAI assistant for FIFA World Cup 2026 stadium operations, built on a simulated
digital twin of MetLife Stadium. It runs entirely in the browser against a seeded crowd
simulation, with no database and no backend state to provision.

Powered by **Google `gemini-3.1-flash-lite`** for the tool-calling agent loop, ticket-scan vision,
and the organizer copilot, behind a provider-agnostic adapter that reads the model from `.env`.

Two personas share one live twin. **Fans** scan a seat QR, then ask an assistant in their own
language for routes, amenities, queue forecasts, and policies, and get proactive alerts, detour
incentives, and an SOS mode. **Organizers** watch a live heatmap, read an AI risk brief and
forecast, dispatch responders to incidents, run scripted crisis scenarios, upload their own
dataset, and generate a post-event debrief. Both views stay in sync across browser tabs.

## Approach & Logic

**The digital twin.** A seeded simulation (`lib/simulation/`) drives per-zone density, gate status,
and a pre-generated forecast timeline across a 129-zone venue graph (`lib/venue/venue.ts`: 60
sections, 60 concourse nodes, 4 gates, 4 transit nodes, 1 field). Density is a deterministic
function of zone id, match clock, and seed, so every browser tab computes identical state without
exchanging it.

**AI versus logic separation.** The LLM never computes a route, ETA, forecast, dispatch, or load
balance. Deterministic functions in `lib/engine/` do that, as pure, unit-tested code. The model's
job is to decide which tool to call, then phrase the result and drive the map. The copilot's
forecast prompt is handed pre-computed numbers and told it may not change them
(`lib/ai/copilot.ts`). Every tool validates zone ids against the venue graph first, so a
hallucinated id cannot reach the engine.

**No database.** State lives in Zustand stores (`lib/store/`). Cross-tab sync is a
`BroadcastChannel` (`lib/simulation/channel.ts`). Nothing is persisted server-side; the only
client-persisted value is the fan's location.

**The model: Google `gemini-3.1-flash-lite`.** This build runs Gemini Flash-Lite
(`LLM_PROVIDER=gemini`, `LLM_MODEL=gemini-3.1-flash-lite`). Two properties of the app drove that
choice, and both are checkable:

- **Vision needs Gemini.** The ticket-scan language detection path (M12) calls `visionChat`.
  `GroqClient.visionChat` throws `VisionUnsupportedError` (`lib/ai/client.ts`), so Gemini is the
  only shipped adapter that can do it.
- **The loop needs to be fast.** The fan agent runs up to two tool round trips plus a forced final
  answer, each capped at `LLM_TIMEOUT_MS=8000`, inside a 15s client-side abort
  (`lib/assistant/client.ts`). A Flash-Lite tier model keeps a multi-call turn inside that budget.
  Gemini also returns the `{ message, language, mapActions, alertLevel }` contract natively via a
  `responseSchema`, so the structured output is requested at the API level rather than only asked
  for in the prompt.

**Provider-agnostic by construction.** The model id is never hardcoded. Provider and model come
from `.env` only, read once through a Zod-validated accessor (`lib/ai/env.ts`). No model id literal
exists anywhere in `lib/`, `app/`, or `components/`, and a test enforces that by recursively
scanning the source tree (`tests/ai/client.test.ts`, describe `provider-agnostic invariant`).
Switching to Groq, or to a different Gemini model, is a one-line `.env` edit with no code change.

## How It Works

### Setup

```bash
git clone <repo-url>
cd stadiumiq
npm install
```

Copy `.env.example` to `.env` and fill it in:

```bash
LLM_PROVIDER=gemini                # supported: gemini | groq
LLM_MODEL=gemini-3.1-flash-lite    # the model this build runs; ticket-scan vision requires gemini
LLM_API_KEY=your-api-key-here
LLM_TIMEOUT_MS=8000                # optional, defaults to 8000
```

`gemini-3.1-flash-lite` is what this submission was built and demoed against. Any model id the
provider accepts will work, and `LLM_PROVIDER=groq` swaps the whole adapter, with the one caveat
that Groq cannot serve the ticket-scan vision path.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server at http://localhost:3000 |
| `npm run build` | Production build (also typechecks and lints) |
| `npm start` | Serve the production build |
| `npm test` | Vitest suite (all LLM calls are mocked) |
| `npm run lint` | ESLint |

Use the header toggle to switch between the Fan and Organizer roles. Open the two roles in two
tabs to see BroadcastChannel sync.

### Fan walkthrough

1. **Onboard.** Simulate a QR scan, scan with the camera, scan a ticket image, or pick your block
   manually. This sets your zone.
2. **Ask.** "Where is the nearest restroom?", "How do I get to my seat?", "What's the quietest way
   out?" The assistant calls the engine, answers, and highlights or routes on the map.
3. **Receive.** Proactive exit alerts and detour incentives appear without being asked.
4. **Escalate.** Distress phrasing raises the alert level, switches the panel to calm mode, and
   files an incident that lands on the organizer dashboard.
5. **SOS.** Triggers a full-screen emergency mode with the safest exit, broadcast to every tab.

### Organizer walkthrough

1. **Dashboard.** Live heatmap, alert feed, active incidents, cascade predictions.
2. **Copilot.** Ask for current risks, or generate a 15-minute forecast with confidence bands,
   root-cause chains, and staff pre-positioning advice.
3. **Dispatch.** Assign a responder to an incident; the engine picks by skill and travel time and
   flags predicted SLA breaches. Resolving an incident generates an AI summary report.
4. **Debrief.** Once the match reaches full time, generate a retrospective covering bottlenecks,
   root causes, response times, and near misses.

### God Mode

In the organizer view, trigger scripted crises to see the system react:

| Scenario | Effect |
|---|---|
| Train Bottleneck | `transit-train` and `gate-b` spike; `gate-b` goes congested |
| Gate Closure | `gate-a` closes; surrounding sections spike and routing reroutes |
| Emergency Evacuation | Wide density spike plus an evacuation incident at `sec-104` |

Scenarios restore baseline first so they do not stack. You can also override a single zone's
density by hand; the override holds for 30 seconds then decays back to simulated values over 20.

### Judge Data-Upload

In the organizer view, upload a JSON dataset to drive the twin with your own numbers. See
`data/sample-upload.json` for the shape:

```json
{
  "density":    { "sec-101": 0.9 },
  "gateStatus": { "gate-a": "closed" },
  "incidents":  [ { "id": "x", "type": "medical", "zoneId": "sec-101",
                    "note": "...", "status": "pending", "createdAt": 600 } ]
}
```

Every zone and gate id is validated against the venue graph, density must be 0 to 1, and unknown
top-level keys are rejected. Valid uploads broadcast to every open tab.

## Architecture

| Directory | Purpose |
|---|---|
| `app/` | Next.js App Router pages plus five server-only API routes (`assistant`, `copilot`, `debrief`, `vision`, `incident-report`) |
| `components/` | Fan view, organizer dashboard, SVG stadium map, shared UI primitives |
| `lib/ai/` | Provider-agnostic LLM client, agent loop, tool registry, prompts, sanitization, RAG-lite |
| `lib/engine/` | Deterministic decision logic as pure functions (routing, forecasting, dispatch, cascade, root cause) |
| `lib/simulation/` | Seeded crowd sim, match sequencer, timeline, BroadcastChannel, God Mode scenarios |
| `lib/venue/` | The venue graph, the single source of truth for both map and routing |
| `lib/store/` | Zustand stores |
| `lib/validation/`, `lib/server/` | Zod request schemas, rate limiter, size-capped body reader |
| `docs/` | `STADIUMIQ-MASTER-DOCUMENTATION.md` plus one doc per module |

The API key stays server-side. Every request body is Zod-validated with a strict schema, size
capped while streaming, and rate limited.

**LLM output contract.** Every assistant reply is parsed against this shape
(`lib/ai/agents.ts`); malformed output is salvaged rather than dropped, and a deterministic stress
heuristic can override `alertLevel` afterwards:

```ts
{
  message: string,
  language: string,
  mapActions: Array<{ op: 'highlight' | 'route' | 'pin', zoneId?: string, path?: string[] }>,
  alertLevel: 'none' | 'info' | 'warn' | 'critical',
  meta?: { tool?: string, stress?: boolean, reportedIncident?: Incident }
}
```

## Feature List → Vertical Mapping

29 modules (M1 to M29) on four foundations (F1 design system, F2 venue graph, F3 simulation,
F4 AI layer). Full detail in `docs/STADIUMIQ-MASTER-DOCUMENTATION.md`.

| # | Feature | Serves |
|---|---|---|
| M1 | QR location onboarding | Real-world context: know where the fan is |
| M2 | Conversational AI assistant | The GenAI assistant itself |
| M3 | Crowd-aware navigation | Contextual decision-making (deterministic, not LLM) |
| M4 | Stadium map + live heatmap | Shared visual twin |
| M5 | Dynamic map highlighting | Makes answers spatial, not text-only |
| M6 | Proactive smart-exit alerts | Proactive, not reactive |
| M7 | Predictive crowd forecasting | Decisions about what will happen |
| M8 | Anti-herding load-balancer | Recommender accounts for its own influence |
| M9 | Smart bribe incentives | Influences behaviour, not just reports it |
| M10 | Hyper-sensory routing | Non-distance human constraints |
| M11 | Accessibility-first routing | Accessibility as a routing constraint |
| M12 | Multilingual concierge | A World Cup crowd is not monolingual |
| M13 | Voice in and out | Hands-free in a loud venue |
| M14 | SOS / emergency override | Highest-stakes safety decision |
| M15 | Stress-adaptive safety | Distress should not require a form |
| M16 | Organizer live ops dashboard | The operations half of the product |
| M17 | Dispatch and AI optimizer | Detection to human action |
| M18 | Organizer AI copilot | Telemetry to an actionable decision |
| M19 | God Mode scenario simulator | Demonstrable crisis response |
| M20 | Judge data-upload panel | Proves the twin is data-driven |
| M21 | Mobile / responsive layout | Fans are on phones |
| M22 | Crowd flow vectors | Direction of travel, not just density |
| M23 | Cascade prediction | Crushes propagate; predict the chain |
| M24 | Automated staff pre-positioning | Acts on the forecast |
| M25 | Bottleneck root-cause explanation | Cause, not just symptom |
| M26 | Forecast confidence intervals | Honest uncertainty |
| M27 | Post-event debrief report | Closes the operational loop |
| M28 | Agent-based crowd visualization | Makes density legible as people |
| M29 | Automatic match sequencer | Full match lifecycle in minutes |

## Assumptions

- One venue: a single modeled stadium (MetLife Stadium), one match at a time.
- All data is simulated. There is no real sensor, ticketing, or transit feed; density is a seeded
  function of zone id and match clock.
- No authentication or authorization. The Fan/Organizer toggle is a UI control, not a security
  boundary.
- No database. State lives in memory and is lost on reload, except the fan's location.
- Cross-tab sync is `BroadcastChannel`, so it is same-browser and same-origin only. It is not
  multi-user sync across devices.
- Rate limiting is in-process, which suits a single-instance deployment.
- Voice and camera depend on browser APIs (Web Speech, `getUserMedia`) and degrade to hidden or
  manual entry when unavailable.
- Vision (ticket scanning) requires a provider that supports it; the Groq adapter rejects it.
- Stress detection is English keyword and punctuation matching.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.10 (App Router, Turbopack) |
| UI | React 19.2.4, React DOM 19.2.4 |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4, `tw-animate-css`, `class-variance-authority`, `tailwind-merge`, `clsx` |
| Components | `@base-ui/react` 1.6, `lucide-react` 1.24 |
| Animation | framer-motion 12.42 |
| State | Zustand 5.0 |
| Validation | Zod 3.24 |
| QR | `jsqr` 1.4 (decode), `qrcode` 1.5 (render) |
| **LLM** | **Google `gemini-3.1-flash-lite`** (Gemini Flash-Lite tier) via the Gemini adapter, with tool calling and native `responseSchema` structured output. Provider-agnostic: a Groq (OpenAI-compatible) adapter also ships. Selected entirely through `.env`. |
| Testing | Vitest 4.1, Testing Library (React 16.3, DOM 10.4, jest-dom 6.9), jsdom 22 |
| Lint | ESLint 9 with `eslint-config-next` |

## Roadmap / Stretch (not built)

- Real data feeds: live sensor, ticketing, or transit integration in place of the simulation.
- Persistence: no database, so no historical match comparison across sessions.
- Multi-venue and multi-match support. The venue graph is one stadium.
- Multi-user sync across devices. This needs a server transport rather than `BroadcastChannel`.
- Authentication, roles, and an audit trail for organizer actions.
- Semantic RAG. Retrieval is keyword overlap over `data/knowledge.md`, with no embeddings or
  vector store.
- Multilingual stress detection. The heuristic is English-only today.
- Shared-store rate limiting for multi-instance deployment.
- Automated accessibility auditing (axe or Lighthouse) in CI.

## License

No license is declared. `package.json` is marked `private: true` and the repository contains no
LICENSE file.
