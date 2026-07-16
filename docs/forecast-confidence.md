# M26 — Forecast Confidence Intervals

## Purpose

Extends M7's point-prediction forecast (a single density value + crossing
time) with a confidence band, so the copilot can say "likely 85–95%,
10–14 min" instead of a single overclaimed number.

## Method actually used: sampled, with a documented heuristic fallback

The codebase's timeline (`lib/simulation/timeline.ts`'s `generateTimeline`)
is a single deterministic, seeded curve — there is no multi-seed ensemble or
Monte Carlo variance source to sample from. However, the timeline *does*
carry real per-frame density values at fixed intervals, so
`computeConfidenceBand` samples the actual density values in a small window
(±2 frames, `SAMPLE_WINDOW_FRAMES`) around the frame nearest the predicted
crossing time and uses their min/max as the band — this **is** real
variance data (the timeline's own near-term trajectory), not fabricated, so
`method: 'sampled'` is used whenever at least 2 distinct frames fall in
that window.

Only when there's no real data to sample — an empty or single-frame
timeline — does it fall back to the documented heuristic (±10% density,
±20% time), and label the result `method: 'heuristic'`.

In practice, with the app's normal seeded timeline (many frames spanning
the match), **`'sampled'` is what actually gets used** during real
gameplay; `'heuristic'` is the degenerate-input fallback.

## Function signature

```ts
function computeConfidenceBand(
  pointPrediction: { density: number; crossingSec: number },
  frames: DensityFrame[],
  zoneId: string
): ConfidenceBand

interface ConfidenceBand {
  densityLow: number;
  densityHigh: number;
  crossingSecEarliest: number;
  crossingSecLatest: number;
  method: 'sampled' | 'heuristic';
}
```

Defined in [`lib/engine/forecastConfidence.ts`](../lib/engine/forecastConfidence.ts).
Pure and synchronous; does not modify or call into `lib/engine/forecast.ts`'s
prediction logic — it only wraps a point prediction the caller already
computed.

## The honesty guarantee on `method`

`method` is set based purely on whether real sampled data was available (≥2
distinct frames in the sampling window), never on a fixed default. The
heuristic branch is a separate, clearly-labeled code path — there is no
shared computation that could cause a heuristic result to be mislabeled as
`'sampled'`. Both branches also guarantee the band contains the exact point
prediction value (widened via `Math.min`/`Math.max` against the point
itself), so the range is never presented as excluding the number it's
supposedly a range around.

## Wiring

`app/api/copilot/route.ts`'s `forecast` branch extends (does not restructure)
each entry in the existing `topZones` array with a `confidenceBand` field,
computed from that zone's density + the forecast's `peakAtSec` against the
same `timeline` frames already sent in the request. `components/organizer/Copilot.tsx`
renders the band as a small muted line under each zone's density badge, e.g.
"likely 85–95%, 10–14 min".
