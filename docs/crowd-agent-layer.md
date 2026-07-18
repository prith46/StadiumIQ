# M28 — Agent-Based Crowd Flow Visualization

## Purpose

A lightweight particle-based crowd visualization: capped, moving point
agents ("fans") drifting toward their zone's goal point on `<StadiumMap>`,
so the crowd visibly moves instead of only being inferred from a color
gradient. The strongest single "wow" proof of the "living, sensed" digital
twin — judges see the crowd move.

## This is cosmetic, display-only — not part of the authoritative simulation

**Agent positions never feed back into `density`, forecast, routing, or
dispatch.** `lib/engine/agentMotion.ts` reads `density` as an *input only*
(to bias spawn distribution and, per-tick, to damp an agent's top speed in
crowded zones) and never writes to it. It is a presentation-layer
simulation running entirely client-side; `SimState.density` remains the
single source of truth. Nothing here is wired into the AI-vs-logic
separation rule that governs `lib/engine/*` used by routing/forecast/
dispatch — this module is intentionally outside that pipeline, as it never
reaches the LLM or any routing decision.

## `MAX_AGENTS` cap rationale

`MAX_AGENTS = 300` (in `lib/engine/agentMotion.ts`) is a hard, non-negotiable
cap. Agent count is silently capped — no UI indication when hit, per spec.
It bounds both the spawn distribution loop and the O(n²) nearest-neighbor
repulsion scan in `stepAgents` (n=300 → 90k comparisons per applied step,
trivial for a throttled ~30fps loop).

## Perf safeguards

- **Opt-in, OFF by default**: a "Show Crowd Simulation (Demo)" toggle on
  `<StadiumMap>` — no cost at all unless explicitly enabled.
- **`prefers-reduced-motion` hard override**: `components/CrowdAgentLayer.tsx`
  renders nothing regardless of toggle state when the media query matches.
- **Frame throttling**: the `requestAnimationFrame` loop only calls
  `stepAgents` every 2nd frame (`FRAME_THROTTLE`), roughly halving CPU cost
  versus a naive per-frame update.
- **Isolated re-renders**: `CrowdAgentLayer` owns its animation state via
  `useRef`/local `useState`, entirely separate from the global Zustand
  store. Its ~30fps re-renders are scoped to its own component subtree and
  never propagate to `<StadiumMap>`'s heatmap, M5 highlights, or M22 flow
  vectors.
- **Cleanup**: `cancelAnimationFrame` runs on unmount and whenever the
  toggle/`prefers-reduced-motion` state turns the layer off, so no animation
  loop is ever left running in the background.
- **Deterministic spawn**: `spawnAgents` consults its seeded PRNG
  (`mulberry32`, reused unmodified from `lib/simulation/engine.ts`) only at
  spawn time — never per frame — so the same `(density, seed)` pair always
  produces the same initial agent layout.

## Wiring

`components/StadiumMap.tsx` adds one `useState` toggle
(`showCrowdAgents`, default `false`) and mounts
`<CrowdAgentLayer enabled={showCrowdAgents} density={density} />` as its own
`<g>` layer, above the heatmap and M22 flow vectors, below M5's
highlight/route/pin overlay — no other existing overlay logic was touched.
