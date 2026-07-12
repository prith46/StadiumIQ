# M24 — Automated Staff Pre-Positioning

## Purpose

Extends the copilot's 15-minute forecast with a concrete staff pre-positioning
recommendation — which responder to move, from where, to where, and by when —
so the forecast ties directly to an action instead of narrative alone.

## Function signature

```ts
function recommendPrepositioning(
  forecastHotspot: { zoneId: string; predictedCrossingSec: number },
  responders: Responder[],
  edges: Edge[],
  count: number = DEFAULT_PREPOSITION_COUNT // 1
): PrepositionRecommendation[]

interface PrepositionRecommendation {
  responderId: string;
  fromZone: string;
  toZone: string;
  recommendedDepartSec: number;
  willArriveInTime: boolean;
}
```

Defined in [`lib/engine/staffPrepositioning.ts`](../lib/engine/staffPrepositioning.ts).

## Assumptions

- **`DEFAULT_PREPOSITION_COUNT = 1`**: recommends one responder per hotspot by
  default, capped at however many idle responders are actually passed in.
- **Reuses M17's dispatch distance logic**: travel time is computed via
  `computeRoute` from `lib/engine/routing.ts` (the same Dijkstra shortest-path
  `assignResponder` in `lib/engine/dispatch.ts` is built on) — not
  reimplemented. Neutral density/routedLoad/gateStatus (`{}`) are passed since
  this is a forward-looking recommendation, not a live route.
- **Double-booking exclusion happens at the call site, not inside the pure
  function**: `Responder` has no incident-awareness of its own, so
  `app/api/copilot/route.ts` marks any responder currently assigned to a
  pending/dispatched incident as `available: false` before calling
  `recommendPrepositioning`. The function itself only filters on
  `responder.available`.
- **Unreachable responders are flagged, not omitted**: if `computeRoute`
  reports no path, `willArriveInTime` is `false` and `recommendedDepartSec`
  falls back to the predicted crossing time itself, so the UI can render an
  "unable to preposition in time" warning line rather than silently dropping
  the recommendation.

## Wiring

`app/api/copilot/route.ts`'s `forecast` branch calls `getForecastBrief`
unchanged, then extends (does not restructure) its response with a
`prepositioning` field computed from the top forecast hotspot zone and
`RESPONDERS`. `components/organizer/Copilot.tsx` renders each recommendation
as an extra line under the existing "Staffing Deployment Advice" card.
