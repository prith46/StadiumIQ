# M23 — Cascade Prediction

## Purpose

Detects chains where one zone's forecast bottleneck is likely to trigger a
downstream bottleneck, using the existing forecast timeline (`DensityFrame[]`)
and venue adjacency (`Edge[]`). Elevates the system from hotspot detection to
predicting systemic failure.

## Algorithm

[`lib/engine/cascadePrediction.ts`](../lib/engine/cascadePrediction.ts) walks
`frames` in chronological order and records each zone's **first** frame
crossing `HOTSPOT_THRESHOLD`. When a zone newly crosses, it looks at zones
with an edge pointing into it (`edge.to === zoneId`) and picks the most
recently-crossed of those — if one crossed within the last
`CASCADE_LOOKBACK_FRAMES` frames — as its trigger. Chains are then built by
walking trigger → effect links from each root (a crossing zone with no
trigger of its own), following the earliest-timed child at each step until no
further downstream zone crosses. Only chains of length ≥ 2 are returned.

Complexity: O(frames × zones × avg-degree) — no pairwise zone comparison.

## Constants

- `HOTSPOT_THRESHOLD = 0.75` — no exported hotspot-threshold constant exists
  elsewhere in the codebase to reuse; Dashboard.tsx only references "0.75" in
  a UI copy string (`components/organizer/Dashboard.tsx`). This constant is
  the resolved fallback, matching that documented value.
- `CASCADE_LOOKBACK_FRAMES = 5` — max frame gap between a trigger's crossing
  and its effect's crossing for them to be linked.

## Assumptions

- **Adjacency-only causation, not full flow-network analysis**: a downstream
  crossing is linked to the nearest already-crossed neighbor within the
  lookback window, not to a computed flow contribution.
- **Single linear chain per root**: if a root has multiple downstream
  candidates, only the earliest one is followed, keeping chains simple and
  readable (`Gate B → Concourse N → Section 214`) rather than a branching
  tree.
- Recomputed via `useMemo` in `Dashboard.tsx`, keyed on the `timeline` array
  reference — no new caching system.

## Auto-Expiry & Coalescence (Fix Batch G)

- **Auto-Expiry**: Cascade alerts automatically clear themselves when the underlying zone densities drop back below the hotspot threshold (`HOTSPOT_THRESHOLD = 0.75`). Since predictions are recomputed every tick, resolved cascades are dropped from the state automatically without requiring manual dismissal.
- **Coalescence**: Rendered via `components/CascadeAlertSummary.tsx`. When multiple cascades are active simultaneously, they are coalesced into a single summary card (e.g. "3 Active Cascades") with an Expand/Collapse toggle to view individual/inner `CascadeAlertCard`s. If exactly one cascade is active, it is rendered as a normal card directly.
