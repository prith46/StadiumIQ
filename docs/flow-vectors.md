# M22 — Crowd Flow Vectors

## Purpose

Animated directional arrows on `StadiumMap` that visualize crowd movement between
adjacent zones, derived from tick-over-tick density deltas. Turns the static
heatmap into a live movement signal.

## `FlowVector` shape

```ts
interface FlowVector {
  edgeId: string;   // `${from}->${to}`
  from: string;      // zone id losing/adjacent to the flow
  to: string;        // zone id gaining density
  magnitude: number; // clamped 0..1, drives arrow scale (0.5x-1.5x base size)
}
```

## Threshold constant

`FLOW_THRESHOLD = 0.03` in [`lib/engine/flowVectors.ts`](../lib/engine/flowVectors.ts).
An edge only produces a vector when `density[to] - previousDensity[to] > FLOW_THRESHOLD`.

## Assumptions

- **2-tick fade**: `StadiumMap` retains a vector for 2 additional ticks after its
  flow drops back below the threshold (tracked in a local fade map), so arrows
  fade out via Framer Motion's exit animation instead of flickering off.
- **Viewport culling reused, not rebuilt**: this overlay renders all computed
  vectors; it relies on whatever viewport-culling `StadiumMap` already has
  (none today), per the M22 scope (no new culling system).
- `previousDensity` is a new field on `useSimStore`, updated once per tick
  alongside the existing density computation — it is not part of `SimState`.
