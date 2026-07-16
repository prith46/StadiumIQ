# M3 — Reasoned Crowd-Aware Navigation Engine

## Purpose

M3 provides the deterministic routing engine for StadiumIQ's "get me there" fan flow. Given a
fan's current location and a destination (seat, POI type, or exit), it computes the
least-congested path through the venue graph, returns an ETA and a structured `reason` object
naming the specific congestion conditions that drove the routing decision.

**Architecture invariant**: The LLM never computes a route. It only phrases a `RouteResult`
that `computeRoute()` already determined. `reason.crowdedZones` and `reason.avoidedGates` are
real computed values — the LLM is instructed to use them verbatim, never invent them. This is
the concrete enforcement point of StadiumIQ's AI-vs-logic separation claim.

---

## File Map

| File | Role |
|------|------|
| `lib/engine/routing.ts` | Pure Dijkstra engine — no zustand, react, or network imports |
| `lib/engine/destinationResolver.ts` | Pure destination-query resolver — same purity guarantee |
| `lib/engine/routingService.ts` | Thin store-reading glue — the ONLY engine file that imports zustand |
| `lib/engine/routing.test.ts` | Unit + integration tests for routing engine |
| `lib/engine/destinationResolver.test.ts` | Unit tests for destination resolver |

---

## Public API

### `computeRoute()` — `lib/engine/routing.ts`

```ts
export function computeRoute(
  originZoneId: string,
  destinationZoneId: string,   // pre-resolved zone id (see §Deviations)
  edges: Edge[],
  zones: Zone[],
  density: Record<string, number>,
  routedLoad: Record<string, number>,
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>,
  filters?: RouteFilters
): RouteResult | { error: 'no_route_found' | 'no_accessible_route_found' }
```

#### `RouteFilters`
```ts
interface RouteFilters {
  accessibleOnly?: boolean;      // HARD filter: excludes edge.accessible === false
  avoidEnclosed?: boolean;       // Soft filter: ×3 weight penalty
  maxNoise?: 'low' | 'med' | 'high';  // Soft filter: ×3 penalty on noisier edges
  avoidAffiliation?: 'home' | 'away'; // Soft filter: ×3 penalty on matching zones
}
```

#### `RouteResult`
```ts
interface RouteResult {
  path: string[];           // ordered zone ids, origin to destination inclusive
  etaSec: number;           // total weighted walk time, rounded to seconds
  reason: {
    crowdedZones: string[]; // zones on the avoided naive path with density > 0.5
    avoidedGates: string[]; // gate ids on the avoided naive path
    etaSec: number;         // mirrors top-level etaSec (for LLM phrasing convenience)
  };
  accessible: boolean;      // true iff path satisfies accessibleOnly when requested
}
```

---

### `resolveDestination()` — `lib/engine/destinationResolver.ts`

```ts
export function resolveDestination(
  query: DestinationQuery,
  originZoneId: string,
  edges: Edge[],
  zones: Zone[],
  pois: Poi[],
  density?: Record<string, number>,
  poiStatus?: Record<string, Poi['status']>,
  gateStatus?: Record<string, 'open' | 'congested' | 'closed'>
): string | ResolveError
```

#### `DestinationQuery`
```ts
type DestinationQuery =
  | { kind: 'zone'; zoneId: string }
  | { kind: 'poiType'; poiType: PoiType }
  | { kind: 'nearestExit' };
```

For `poiType`: returns the `nearestZone` of the closest open POI of that type
(distance measured via unweighted Dijkstra to avoid double-counting live congestion).

For `nearestExit`: prefers `open` gates over `congested` ones even if the congested
gate is geometrically closer. Hard-excludes `closed` gates.

---

### `shortestDistance()` — shared helper

```ts
export function shortestDistance(graph: Graph, from: string, to: string): number
```

Used by both `computeRoute` (second-best path computation) and `resolveDestination`
(nearest-POI ranking). Reuses the same `buildGraph` helper to avoid duplicating
graph-construction logic.

---

## Congestion Formula

```
weight(edge) = edge.baseWalkSec × congestionFactor(density[edge.to] ?? 0, routedLoad[edge.to] ?? 0)

congestionFactor(d, load) = 1 + 2.5 * d + 0.15 * min(load, 10)
```

### Constants (tuning guide)

| Constant | Value | Meaning |
|----------|-------|---------|
| Density weight | `2.5` | At density=1.0 (full), adds 250% to walk time |
| Load weight | `0.15` | Each additional routed fan adds 15% |
| Load cap | `10` | routedLoad capped at 10 to prevent unbounded penalty |
| CONGESTED gate multiplier | `4×` | Heavy but traversable gate penalty |
| Soft filter multiplier | `3×` | avoidEnclosed / maxNoise / avoidAffiliation penalty |

To tune congestion sensitivity: adjust the `2.5` coefficient. To tune anti-herding sensitivity
(pending M8): adjust the `0.15` coefficient and load cap.

---

## Filter Semantics: Hard vs Soft

| Filter | Type | Behavior |
|--------|------|----------|
| `accessibleOnly: true` | **Hard** | Inaccessible edges are completely removed from the graph before Dijkstra runs. If no accessible path exists, returns `{ error: 'no_accessible_route_found' }`. |
| `avoidEnclosed: true` | **Soft** | Enclosed edges receive ×3 weight penalty. A route still exists even if the only path is enclosed. |
| `maxNoise: 'low'|'med'` | **Soft** | Edges noisier than the limit receive ×3 penalty. |
| `avoidAffiliation` | **Soft** | Destination zones of matching affiliation receive ×3 penalty. |
| Closed gate | **Hard** | `gateStatus[id] === 'closed'` gates are excluded from the graph (cannot be passed through or reached). |
| Congested gate | **Soft** | `gateStatus[id] === 'congested'` gets ×4 multiplier — reachable but expensive. |

---

## `routedLoad` Integration (§6.3 — Minimal, M8-forward)

After a successful route is computed, `routingService.ts` (and the F4 tool adapter in
`lib/ai/tools.ts`) calls `incrementRoutedLoad(exitGateZoneId)` exactly once. This increments
the Zustand store's `routedLoad[gateId]` counter by 1.

**This is the ONLY anti-herding behavior M3 implements.** Full load-balancing strategy (dynamic
threshold adjustments, fan redistribution across gates, multi-route suggestions) is M8's scope
and will build on top of this counter.

The `incrementRoutedLoad` action is exposed on `useSimStore` and defined in `lib/store/simStore.ts`.

---

## F4 Tool Contract

The `computeRoute` tool is registered in `lib/ai/tools.ts` under `TOOL_REGISTRY`. It:

1. Validates `originZoneId` (or legacy `fromZoneId`) against real `ZONES` entries. Invalid/hallucinated ids return a structured `{ error: 'invalid_zone_id', message: '...' }` — never an unhandled exception.
2. Accepts a `destination` object (`{ kind: 'zone'|'poiType'|'nearestExit', ... }`).
3. Resolves the destination via `resolveDestination()`.
4. Calls the pure `computeRoute()`.
5. Returns a `RouteResult` — the LLM is instructed to phrase `reason.crowdedZones` / `reason.avoidedGates` / `etaSec` into natural language, **never to invent values**.

### LLM Phrasing Contract

The system prompt instructs the LLM:
- If `reason.crowdedZones` and `reason.avoidedGates` are **empty**: phrase as "most direct route".
- If they are **non-empty**: use the actual zone/gate names and the actual `etaSec` value from `reason`.
- The LLM **must not** invent alternative routes, congestion estimates, or time values not present in the tool result.

---

## Deviations from §6.1 Spec (documented per §15)

### Deviation 1 — `computeRoute()` signature

**Spec (§6.1):** `computeRoute(originZoneId, destination: DestinationQuery, density, routedLoad, gateStatus, filters)`

**Implementation:** `computeRoute(originZoneId, destinationZoneId: string, edges, zones, density, routedLoad, gateStatus, filters)`

The pure engine function accepts a **pre-resolved destination zone id** instead of a raw
`DestinationQuery`. Destination resolution (POI table lookup, nearest-exit selection) is
delegated to `destinationResolver.ts`. The service layer (`routingService.ts` and the F4 tool
adapter) calls `resolveDestination()` first, then passes the resulting zone id to `computeRoute()`.

**Rationale:** Cleaner separation of concerns. The routing algorithm is graph-only and requires
no POI table access. The resolver is independently testable. Neither function has to import
the other's concerns. Both are provably pure: `routing.ts` imports only from `lib/types.ts` and
standard JS; `destinationResolver.ts` imports only from `lib/types.ts` and `./routing` (for the
shared `buildGraph`/`shortestDistance` helpers).

### Deviation 2 — `fromZoneId` legacy alias in tool schema

**Spec:** Not mentioned (spec introduces `originZoneId`).

**Implementation:** The `computeRoute` F4 tool schema accepts both `originZoneId` (preferred,
spec-aligned) and `fromZoneId` (legacy alias).

**Rationale:** The pre-M3 stub already used `fromZoneId` in its schema, and any existing
callers (including `runOrganizerCopilot` test fixtures) would silently fail with a missing-origin
error on a hard rename. The alias adds zero implementation complexity: `originZoneId ?? fromZoneId`.
New callers should use `originZoneId`. This is not scope creep — it is a backward-compatibility
shim required to avoid breaking existing code without a migration step.

---

## Graph Connectivity Notes

The real venue graph (`ZONES` + `EDGES` from `lib/venue/venue.ts`) was exercised against 3+
origin/destination pairs in `lib/engine/routing.test.ts` (integration smoke tests). No
disconnected zones were discovered: all seating sections connect to concourses, all concourses
connect to gates, and all gates connect to transit nodes. If a future venue change introduces
a disconnected zone, `computeRoute` will return `{ error: 'no_route_found' }` — this is the
correct behavior. A build-time audit script (not part of M3) could be added to warn on
disconnected subgraphs.

---

## Out of Scope (§14)

- Full anti-herding / load-balancing (M8) — only the single `incrementRoutedLoad` counter is M3's responsibility.
- Forecasting / predictive congestion (M7) — M3 reads current density only.
- Route rendering on the map (M5) — M3 returns `path: string[]`; the existing `mapActionDispatcher` + `StadiumMap.drawRoute` ref handle rendering.
- Hyper-sensory UI (M10) / accessibility routing UI (M11) — M3 implements filter mechanics; those modules wire user-facing controls.
- Incident/dispatch routing (M17) — separate engine.
