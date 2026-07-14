/**
 * lib/engine/routing.ts
 *
 * Pure, synchronous routing engine for M3 (Crowd-Aware Navigation).
 *
 * DESIGN DEVIATION (documented per §15):
 *   The public `computeRoute()` function accepts a pre-resolved destination zone id
 *   (a plain string), NOT the raw `DestinationQuery` union specified in §6.1.
 *   Destination resolution (POI lookup, nearest-exit selection) is the responsibility
 *   of `destinationResolver.ts`; `routingService.ts` calls `resolveDestination()` first,
 *   then passes the resulting zone id here. This gives cleaner separation: the pure
 *   routing algorithm never needs POI table access, and `computeRoute` stays a
 *   graph-only function that is trivially unit-testable with fixture graphs.
 *   See docs/M3-routing.md §Deviations for full rationale.
 *
 * This file has NO imports from zustand, react, or any network/fetch module.
 * All live-state inputs (density, routedLoad, gateStatus) are passed in explicitly.
 */

import { Edge, Zone } from '../types';
import { routedLoadPenalty } from './loadBalance';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface RouteFilters {
  /** Hard exclude any edge with accessible === false. */
  accessibleOnly?: boolean;
  /** Penalise (×3) enclosed edges/zones. Soft filter — never hard excludes. */
  avoidEnclosed?: boolean;
  /**
   * Penalise (×3) edges whose noise level exceeds maxNoise.
   * 'low' ⇒ penalise med+high; 'med' ⇒ penalise high; 'high' ⇒ no penalty.
   * Soft filter — never hard excludes.
   */
  maxNoise?: 'low' | 'med' | 'high';
  /** Penalise (×3) zones/edges whose affiliation matches the value. Soft. */
  avoidAffiliation?: 'home' | 'away';
}

export interface SensoryFilterOptions {
  quiet?: boolean;
  openAir?: boolean;
  avoidAffiliation?: 'home' | 'away';
}

/**
 * Extends existing edge-weight/cost function with additive sensory penalties.
 * Adds 50% baseWalkSec penalty for noise:high (quiet), enclosed:true (openAir),
 * or matching avoidAffiliation.
 */
export function sensoryPenalty(
  edge: Edge,
  toZone: Zone | undefined,
  options: SensoryFilterOptions
): number {
  let penalty = 0;
  if (options.quiet && edge.noise === 'high') {
    penalty += 0.5 * edge.baseWalkSec;
  }
  if (options.openAir && edge.enclosed) {
    penalty += 0.5 * edge.baseWalkSec;
  }
  if (options.avoidAffiliation && toZone && toZone.attrs && toZone.attrs.affiliation === options.avoidAffiliation) {
    penalty += 0.5 * edge.baseWalkSec;
  }
  return penalty;
}

export interface RouteResult {
  /** Ordered zone ids from origin to destination, inclusive. */
  path: string[];
  /** Total walk time in seconds on the chosen path (weighted). */
  etaSec: number;
  reason: {
    /**
     * Zone ids that were on the *alternative* (naive shortest-distance) path
     * but were avoided because of congestion. Empty when no trade-off occurred.
     */
    crowdedZones: string[];
    /**
     * Gates that were on the *alternative* path but bypassed.
     * Empty when no trade-off occurred.
     */
    avoidedGates: Array<{ gateId: string; cause: 'congested' | 'closed' }>;
    /** Mirrors top-level etaSec (structured for LLM phrasing convenience). */
    etaSec: number;
  };
  /** True iff the path satisfies accessibleOnly when requested. */
  accessible: boolean;
}

export interface AccessibleRouteResult {
  path: string[] | null;
  etaSec: number | null;
  reason: { crowdedZones: string[]; avoidedGates: Array<{ gateId: string; cause: 'congested' | 'closed' }> };
  accessible: boolean;
  noRouteFound?: boolean;
}

export type RouteError =
  | { error: 'no_route_found' }
  | ({ error: 'no_accessible_route_found' } & AccessibleRouteResult);

// ---------------------------------------------------------------------------
// Internal graph types
// ---------------------------------------------------------------------------

interface GraphEdge {
  to: string;
  weight: number;
  accessible: boolean;
  enclosed: boolean;
  noise: 'low' | 'med' | 'high';
  /** Zone affiliation of the destination zone (from Zone.attrs.affiliation). */
  affiliation?: 'home' | 'away' | 'neutral';
}

export type Graph = Map<string, GraphEdge[]>;

/**
 * Optional pre-built graphs for callers that route many origin/destination
 * pairs against the SAME live state in one pass (e.g. incentive triage ranks
 * every candidate POI): without this, computeRoute rebuilds the weighted
 * graph — and possibly the naive comparison graph — once per call.
 *
 * `weighted` must be built with the same (filters, gateStatus, density,
 * routedLoad) the computeRoute call receives; `naive` with the same filters
 * and empty live state. Both are what computeRoute would build itself.
 */
export interface PrebuiltGraphs {
  weighted?: Graph;
  naive?: Graph;
}

// ---------------------------------------------------------------------------
// Congestion formula (§6.2)
// ---------------------------------------------------------------------------

/**
 * congestionFactor(d, load) = 1 + 2.5 * d + 0.15 * min(load, 10)
 *
 * Monotone increasing in both d (density 0–1) and load (routedLoad count).
 * The cap on load (min(load, 10)) ensures the penalty term stays bounded
 * so a single busy gate never gets an astronomically high weight.
 */
export function congestionFactor(
  density: number,
  load: number,
  routedLoad?: Record<string, number>,
  gateId?: string
): number {
  const penalty = (routedLoad && gateId)
    ? routedLoadPenalty(routedLoad, gateId)
    : 0.15 * Math.min(load, 10);
  return 1 + 2.5 * density + penalty;
}

// ---------------------------------------------------------------------------
// Graph construction (shared helper — §9 efficiency requirement)
// ---------------------------------------------------------------------------

const CONGESTED_GATE_MULTIPLIER = 4;
const SOFT_FILTER_MULTIPLIER = 3;

/**
 * Build a weighted adjacency map from raw edges plus live state.
 * Called by both computeRoute and shortestDistance to avoid duplicating
 * graph-construction logic (§9 efficiency requirement).
 *
 * @param edges         The raw EDGES array from venue.ts
 * @param zones         The ZONES array (needed for affiliation attrs)
 * @param filters       Optional route filters
 * @param gateStatus    Live gate status map
 * @param density       Live density per zone id
 * @param routedLoad    Live routed-load count per zone id
 */
export function buildGraph(
  edges: Edge[],
  zones: Zone[],
  filters: RouteFilters = {},
  gateStatus: Record<string, 'open' | 'congested' | 'closed'> = {},
  density: Record<string, number> = {},
  routedLoad: Record<string, number> = {},
  sensory?: SensoryFilterOptions
): Graph {
  // Build zone lookup for affiliation checks
  const zoneById = new Map<string, Zone>();
  for (const z of zones) zoneById.set(z.id, z);

  const graph: Graph = new Map();

  // Ensure every zone appears as a node even if it has no outbound edges
  for (const z of zones) {
    if (!graph.has(z.id)) graph.set(z.id, []);
  }

  for (const edge of edges) {
    // Hard exclude: closed gates as pass-through destinations
    const toGateStatus = gateStatus[edge.to];
    if (toGateStatus === 'closed') continue;

    // Hard exclude: inaccessible edges when accessibleOnly is set
    if (filters.accessibleOnly && !edge.accessible) continue;

    const destZone = zoneById.get(edge.to);
    const d = density[edge.to] ?? 0;
    const load = routedLoad[edge.to] ?? 0;

    // Base weight with congestion
    let weight = edge.baseWalkSec * congestionFactor(d, load, routedLoad, edge.to);

    if (sensory) {
      weight += sensoryPenalty(edge, destZone, sensory);
    }

    // Congested gate: heavy penalty (×4) but NOT hard excluded
    if (toGateStatus === 'congested') {
      weight *= CONGESTED_GATE_MULTIPLIER;
    }

    // --- Soft filters (×3 penalty, never hard exclusion) ---

    if (filters.avoidEnclosed && edge.enclosed) {
      weight *= SOFT_FILTER_MULTIPLIER;
    }

    if (filters.maxNoise) {
      const noiseOrder = { low: 0, med: 1, high: 2 };
      const maxAllowed = noiseOrder[filters.maxNoise];
      const edgeNoise = noiseOrder[edge.noise];
      if (edgeNoise > maxAllowed) {
        weight *= SOFT_FILTER_MULTIPLIER;
      }
    }

    if (filters.avoidAffiliation && destZone) {
      const aff = destZone.attrs.affiliation;
      if (aff === filters.avoidAffiliation) {
        weight *= SOFT_FILTER_MULTIPLIER;
      }
    }

    let list = graph.get(edge.from);
    if (!list) {
      list = [];
      graph.set(edge.from, list);
    }
    list.push({
      to: edge.to,
      weight,
      accessible: edge.accessible,
      enclosed: edge.enclosed,
      noise: edge.noise,
      affiliation: destZone?.attrs.affiliation,
    });
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Binary min-heap priority queue (O((V+E) log V) Dijkstra, §9)
// ---------------------------------------------------------------------------

interface HeapNode {
  id: string;
  cost: number;
}

class MinHeap {
  private heap: HeapNode[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(node: HeapNode): void {
    this.heap.push(node);
    this._bubbleUp(this.heap.length - 1);
  }

  pop(): HeapNode | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  private _bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].cost <= this.heap[i].cost) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  private _sinkDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l].cost < this.heap[smallest].cost) smallest = l;
      if (r < n && this.heap[r].cost < this.heap[smallest].cost) smallest = r;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// Dijkstra implementation
// ---------------------------------------------------------------------------

interface DijkstraResult {
  /** Reconstructed path of zone ids, or null if unreachable. */
  path: string[] | null;
  /** Total cost of the path. */
  cost: number;
}

/**
 * Run Dijkstra from `from` to `to` on `graph`.
 * Returns the shortest path and its cost, or null path if unreachable.
 */
function dijkstra(graph: Graph, from: string, to: string): DijkstraResult {
  const dist = new Map<string, number>();
  const prev = new Map<string, string>();

  dist.set(from, 0);
  const heap = new MinHeap();
  heap.push({ id: from, cost: 0 });

  while (heap.size > 0) {
    const { id: curr, cost } = heap.pop()!;

    // Skip stale entries
    if (cost > (dist.get(curr) ?? Infinity)) continue;
    if (curr === to) break;

    const neighbours = graph.get(curr) ?? [];
    for (const edge of neighbours) {
      const newCost = cost + edge.weight;
      if (newCost < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, newCost);
        prev.set(edge.to, curr);
        heap.push({ id: edge.to, cost: newCost });
      }
    }
  }

  if (!dist.has(to) || dist.get(to) === Infinity) {
    return { path: null, cost: Infinity };
  }

  // Reconstruct path
  const path: string[] = [];
  let curr: string | undefined = to;
  while (curr !== undefined) {
    path.unshift(curr);
    curr = prev.get(curr);
  }

  return { path, cost: dist.get(to)! };
}

/**
 * Convenience wrapper: returns the weighted cost from `from` to `to`
 * without the path reconstruction. Shared by destinationResolver.ts.
 */
export function shortestDistance(
  graph: Graph,
  from: string,
  to: string
): number {
  return dijkstra(graph, from, to).cost;
}

// ---------------------------------------------------------------------------
// Gate detection helper
// ---------------------------------------------------------------------------

function isGateId(zoneId: string): boolean {
  return zoneId.startsWith('gate-');
}

// ---------------------------------------------------------------------------
// Density-threshold for triggering second-best path computation (§9)
// ---------------------------------------------------------------------------
const CONGESTION_THRESHOLD = 0.5;

/**
 * Minimum routedLoad that justifies the naive-vs-weighted comparison run.
 * routedLoadPenalty contributes 0.15 × min(load, 10) to a congestion factor
 * that is ≥ 1, so a decayed remnant below 1 shifts an edge weight by < 15% —
 * not enough to plausibly change which path wins, only to trigger a pointless
 * second graph build + Dijkstra. (0.9× multiplicative decay leaves sub-1
 * remnants around for ~20 ticks after every routing, so a `> 0` check made
 * the comparison run on virtually every route of a session.) The comparison
 * only feeds the `reason` explanation; path choice itself is unaffected.
 */
const ROUTED_LOAD_REASON_THRESHOLD = 1;

// ---------------------------------------------------------------------------
// computeRoute — main public API
// ---------------------------------------------------------------------------

/**
 * Compute the least-congested route from `originZoneId` to `destinationZoneId`.
 *
 * DEVIATION NOTE: This function accepts a pre-resolved destination zone id, not
 * the raw DestinationQuery from §6.1. See file header and docs/M3-routing.md
 * §Deviations for rationale.
 *
 * @param originZoneId       Starting zone (must be a valid ZONES id)
 * @param destinationZoneId  End zone (pre-resolved by destinationResolver.ts)
 * @param edges              The EDGES array from venue.ts
 * @param zones              The ZONES array from venue.ts
 * @param density            Live density per zone id
 * @param routedLoad         Live routed-load count per zone id
 * @param gateStatus         Live gate status map
 * @param filters            Optional route filters
 * @param sensory            Optional one-off sensory penalties
 * @param prebuilt           Optional pre-built graphs (see PrebuiltGraphs)
 */
export function computeRoute(
  originZoneId: string,
  destinationZoneId: string,
  edges: Edge[],
  zones: Zone[],
  density: Record<string, number>,
  routedLoad: Record<string, number>,
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>,
  filters: RouteFilters = {},
  sensory?: SensoryFilterOptions,
  prebuilt?: PrebuiltGraphs
): RouteResult | RouteError {
  // Build the weighted graph (or reuse the caller's per-pass prebuilt one)
  const graph = prebuilt?.weighted ?? buildGraph(edges, zones, filters, gateStatus, density, routedLoad, sensory);

  // Primary Dijkstra run
  const primary = dijkstra(graph, originZoneId, destinationZoneId);

  if (!primary.path) {
    // If accessibleOnly was set, report that specifically
    if (filters.accessibleOnly) {
      // Re-run without filter to see if any route exists at all
      const unfiltered = buildGraph(edges, zones, {}, gateStatus, density, routedLoad);
      const check = dijkstra(unfiltered, originZoneId, destinationZoneId);
      if (check.path) {
        return {
          error: 'no_accessible_route_found',
          path: null,
          etaSec: null,
          reason: { crowdedZones: [], avoidedGates: [] },
          accessible: false,
          noRouteFound: true,
        };
      }
    }
    return { error: 'no_route_found' };
  }

  const etaSec = Math.round(primary.cost);
  const primaryPath = primary.path;

  // --- Second-best path computation (§6.2, §9) ---
  // Trigger when any zone in the density map is above the threshold —
  // we need to check if congestion caused us to deviate from the naive shortest path,
  // which means the avoided congested zone may NOT be on the chosen path at all.
  let crowdedZones: string[] = [];
  let avoidedGates: Array<{ gateId: string; cause: 'congested' | 'closed' }> = [];

  const anyCongestion =
    Object.values(density).some((d) => d > CONGESTION_THRESHOLD) ||
    Object.values(routedLoad).some((load) => load >= ROUTED_LOAD_REASON_THRESHOLD) ||
    Object.values(gateStatus).some((status) => status === 'closed' || status === 'congested');

  if (anyCongestion) {
    // Build an unweighted (base-only) graph to find naive shortest path
    const naiveGraph = prebuilt?.naive ?? buildGraph(edges, zones, filters, {}, {}, {});
    const naive = dijkstra(naiveGraph, originZoneId, destinationZoneId);

    if (naive.path && naive.path.join(',') !== primaryPath.join(',')) {
      // The naive path differs: populate reason with zones/gates that would
      // have been on the naive path but were avoided in the weighted path.
      const primarySet = new Set(primaryPath);
      crowdedZones = naive.path.filter(
        (id) => !primarySet.has(id) && (density[id] ?? 0) > CONGESTION_THRESHOLD
      );
      avoidedGates = naive.path
        .filter((id) => !primarySet.has(id) && isGateId(id))
        .map((id) => {
          const cause = gateStatus[id] === 'closed' ? 'closed' : 'congested';
          return { gateId: id, cause };
        });
    }
  }

  // --- Closed-exit reasoning (Fix Batch H-2) ---
  // When the destination itself is a gate/exit, other closed gates are exits
  // the fan was steered away from. Those closed gates are candidate
  // *destinations* excluded during nearest-exit resolution (see
  // destinationResolver.ts `nearestExit`) — they are never waypoints on the
  // path TO the chosen gate, so the naive-vs-primary path diff above can never
  // surface them, and `avoidedGates` came back empty in exactly the reported
  // "3 gates closed, forced through the 4th" scenario. Add them explicitly
  // (deduped, sorted for determinism) so the route explanation can state WHY
  // this exit was chosen. Scoped to gate destinations so amenity/zone routes
  // aren't polluted with unrelated closure noise.
  if (isGateId(destinationZoneId)) {
    const alreadyListed = new Set(avoidedGates.map((g) => g.gateId));
    const closedExits = Object.entries(gateStatus)
      .filter(
        ([gateId, status]) =>
          status === 'closed' && gateId !== destinationZoneId && !alreadyListed.has(gateId)
      )
      .map(([gateId]) => gateId)
      .sort();
    for (const gateId of closedExits) {
      avoidedGates.push({ gateId, cause: 'closed' });
    }
  }

  return {
    path: primaryPath,
    etaSec,
    reason: {
      crowdedZones,
      avoidedGates,
      etaSec,
    },
    accessible: filters.accessibleOnly ? true : primaryPath.length > 0,
  };
}
