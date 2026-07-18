# M25 — Bottleneck Root-Cause Explanation

## Purpose

Given a congested zone, walks backward through the same causal graph M23's
cascade prediction walks forward, to find the earliest identifiable upstream
trigger — a gate closure, an incident, or an adjacent zone that crossed the
hotspot threshold first — and returns an ordered chain from root cause to
current symptom.

## Reuse relationship with `cascadePrediction.ts`

`lib/engine/cascadePrediction.ts` was extended (not duplicated) with two
exported helpers that `traceRootCause` now shares:

- `buildIncomingMap(edges)` — zoneId → ids of zones with an edge pointing
  into it. Identical adjacency direction is needed both forward (M23) and
  backward (M25).
- `computeFirstCrossings(frames, threshold)` — first frame index/`atSec` at
  which each zone's density crosses the threshold.

`HOTSPOT_THRESHOLD` and `CASCADE_LOOKBACK_FRAMES` are imported from
`cascadePrediction.ts`, not redefined. `predictCascades` itself is
unchanged in behavior — its existing test file was re-run to confirm this.

## Algorithm

`traceRootCause(symptomZoneId, history, gateStatus, incidents, edges)`
treats the last frame in `history` as "now" and walks backward from
`symptomZoneId`, at each step checking, in priority order:

1. **Self-check**: does the current zone have its own incident, or (if it's
   a gate) is its current status `closed`/`congested`? If so, that's a
   terminal root cause.
2. **Neighbor-check**: among upstream neighbors (`buildIncomingMap`), does
   any have an incident, a bad gate status, or an earlier threshold
   crossing within `CASCADE_LOOKBACK_FRAMES`? Incidents and gate statuses
   are terminal; an earlier-crossing neighbor becomes the new "current zone"
   and the walk continues (bounded by `MAX_TRACE_HOPS = 10`), producing
   multi-hop chains.
3. If neither check finds anything **and no links have been found yet**,
   the chain is a single "no clear trigger" link — see below.

The resulting links are built symptom-first and reversed before returning,
so `chain[0]` is the root cause and the last entry is the immediate trigger
for `symptomZoneId`.

## The "no fabricated cause" guarantee

`CauseLink.kind` is `'gate_status' | 'incident' | 'adjacent_zone' | 'none'`
— `'none'` is a deliberate addition beyond the module's otherwise-3-value
causal vocabulary. It exists specifically so that "no identifiable trigger"
can be represented truthfully (as its own explicit, typed value) instead of
either fabricating a plausible-sounding cause or being forced to omit a
`kind` value. This link is only ever produced when the trace found *zero*
causal links for the original symptom zone (self-check and neighbor-check
both empty on the very first hop) — if some upstream hops were found before
the trace ran out of leads, the partial chain is returned as-is rather than
padded with a synthetic "no clear trigger" entry.

## Wiring

`app/api/copilot/route.ts`'s `brief` branch (the "biggest risks now"
response) calls `getCopilotBrief` unchanged, then extends each `topRisks`
item that names a `zoneId` with a `rootCause` field computed via
`traceRootCause`, using `validated.simSnapshot.timeline` as the frame
history — the same array `cascadePrediction` already reads, no new
persistence. `components/organizer/Copilot.tsx` renders a "Why?" toggle on
each risk item that expands into the causal chain, styled consistently with
the existing risk card.
