# StadiumIQ

A GenAI-powered operations assistant for FIFA World Cup 2026 stadium operations, built on a
simulated digital twin of MetLife Stadium. Fans get a multilingual, crowd-aware AI assistant
(navigation, amenities, safety, SOS); organizers get a live ops console with an AI copilot,
crowd forecasting, incident dispatch, and post-event debriefs.

## How it works

Every AI answer is grounded in deterministic engine output — the LLM never invents numbers:

- **Simulation layer** (`lib/simulation/`) — a seeded match-day crowd simulation (pre-match →
  live → egress) driving per-zone density, gate status, and a forecast timeline across a
  92-zone venue graph (`lib/venue/venue.ts`).
- **Logic engines** (`lib/engine/`) — pure, unit-tested functions: crowd-aware Dijkstra routing
  with accessibility/sensory filters, forecasting, cascade prediction, root-cause tracing,
  incident dispatch, anti-herding load balancing, and incentive triage.
- **AI layer** (`lib/ai/`) — a provider-agnostic LLM client (Gemini or Groq) with tool calling.
  The model must call engine tools (`computeRoute`, `getForecast`, `getPolicy`, …) for factual
  claims; free-text and image inputs pass through prompt-injection sanitization.
- **API routes** (`app/api/`) — `assistant` (fan chat), `copilot` (organizer brief/forecast),
  `debrief` (post-event report), `vision` (ticket scan → language detection). All inputs are
  Zod-validated server-side; the LLM key never reaches the browser.
- **UI** (`components/`, Zustand stores in `lib/store/`) — fan view (map + chat + alerts +
  incentives) and organizer dashboard (heatmap, dispatch queue, god-mode scenarios, uploads),
  synced across tabs via BroadcastChannel.

## Getting started

```bash
npm install
```

Create `.env` in this directory (or copy `.env.example`):

```bash
LLM_PROVIDER=gemini        # or: groq
LLM_MODEL=<model-id>       # e.g. a Gemini flash model (vision requires gemini)
LLM_API_KEY=<your-key>
LLM_TIMEOUT_MS=8000        # optional, default 8000
```

Then:

```bash
npm run dev     # http://localhost:3000
npm test        # vitest (LLM calls are mocked)
npm run build   # production build
```

Use the header toggle to switch between the **Fan** and **Organizer** roles. Docs for every
module live in `docs/` (see `docs/STADIUMIQ-MASTER-DOCUMENTATION.md`).
