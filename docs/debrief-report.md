# M27 — Post-Event Debrief Report

## Purpose

Once the match reaches full-time, generates a one-shot AI-written debrief —
biggest bottlenecks, incident response times, near-misses, and what would
have prevented each — from data already collected during the session. Closes
the "digital twin" loop with retrospective analysis, not just live tooling.

## Data sources aggregated

`lib/engine/debriefData.ts`'s `aggregateDebriefData(state, edges)` is pure
and synchronous — no LLM call inside, just real data shaping:

- **Top 3 bottlenecks by peak density**: scans `state.timeline` (the same
  pre-generated frame history M23's cascade prediction and M26's confidence
  bands already read — no new persistence) plus the live `state.density`
  snapshot, takes the 3 zones with the highest observed density.
- **Root-cause chains**: for each top bottleneck, calls M25's
  `traceRootCause` unmodified, using `state.timeline`, `state.gateStatus`,
  `state.incidents`, and the venue `edges`.
- **Incident response stats**: resolved incidents with a recorded `etaSec`.

### Why `responseSec` is `etaSec`, not a dispatched→resolved delta

`Incident` (in `lib/types.ts`) has no persisted `dispatchedAt`/`resolvedAt`
timestamps — only `createdAt` and an optional `etaSec` set at dispatch time.
There is no real wall/sim-clock delta available to compute. Rather than
inventing one, `responseSec` uses the actual recorded `etaSec` (the
graph-walk time M17's `assignResponder` computed) — a real, non-fabricated
number, just not literally a dispatched→resolved delta. `breached` reuses
`lib/engine/dispatch.ts`'s `isBreachPredicted` on that same value, unmodified.

## One-shot generation model

`app/api/debrief/route.ts` is a single request/response — no streaming, no
polling. It validates input the same way `/api/copilot` does (zod schema,
defense-in-depth even though there's no free-text input), calls
`aggregateDebriefData`, and makes exactly one `client.chat(...)` call via
the existing `lib/ai/client.ts` (unmodified — its `fetchWithRetry` already
provides the timeout + 1-retry resilience). On any failure (timeout,
malformed JSON, provider error), it falls back to a deterministic report
string built directly from the same aggregated `DebriefInput` — so the
report is never blank even when the LLM call fails.

## UI

`components/organizer/DebriefReport.tsx` gates its "Generate Debrief" button
on `matchPhase(matchClockSec) === 'fullTime'` (reusing
`lib/simulation/engine.ts`'s existing phase detection — not reimplemented),
showing a tooltip when disabled. It renders a loading state during the
single request, the returned report (with `##`-prefixed lines shown as
section headers), and an error state with a retry button on failure. Mounted
as a full-width panel below the Organizer dashboard's main work grid.
