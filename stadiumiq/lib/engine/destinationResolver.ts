/**
 * lib/engine/destinationResolver.ts
 *
 * Pure destination-query resolver for M3 (Crowd-Aware Navigation).
 *
 * Resolves a DestinationQuery (zone id, POI type, or nearest exit) into a
 * concrete zone id that computeRoute() can then path-find to.
 *
 * This file has NO imports from zustand, react, or any network/fetch module.
 */

import { PoiType, Poi } from '../types';
import { Edge, Zone } from '../types';
import { buildGraph, shortestDistance } from './routing';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DestinationQuery =
  | { kind: 'zone'; zoneId: string }
  | { kind: 'poiType'; poiType: PoiType }
  | { kind: 'nearestExit' };

export type ResolveError =
  | { error: 'no_matching_poi' }
  | { error: 'no_open_exit' }
  | { error: 'unknown_zone' };

// ---------------------------------------------------------------------------
// resolveDestination
// ---------------------------------------------------------------------------

/**
 * Resolve a DestinationQuery into a concrete zone id.
 *
 * @param query          What the fan wants to reach
 * @param originZoneId   Fan's current zone (used for distance ranking)
 * @param edges          EDGES from venue.ts (used to build distance graph)
 * @param zones          ZONES from venue.ts
 * @param pois           POIS from venue.ts (or a filtered subset)
 * @param density        Live density per zone (used to prefer less crowded POI zones)
 * @param poiStatus      Live status overrides keyed by poi.id (merged with poi.status)
 * @param gateStatus     Live gate status map (needed for nearestExit)
 */
export function resolveDestination(
  query: DestinationQuery,
  originZoneId: string,
  edges: Edge[],
  zones: Zone[],
  pois: Poi[],
  density: Record<string, number> = {},
  poiStatus: Record<string, Poi['status']> = {},
  gateStatus: Record<string, 'open' | 'congested' | 'closed'> = {},
  routedLoad: Record<string, number> = {}
): string | ResolveError {
  // Build a lightly-weighted (distance plus routing load) graph for nearest-zone lookups
  const distGraph = buildGraph(edges, zones, {}, {}, {}, routedLoad);

  if (query.kind === 'zone') {
    // Validate zone id exists
    const valid = zones.some((z) => z.id === query.zoneId);
    if (!valid) return { error: 'unknown_zone' };
    return query.zoneId;
  }

  if (query.kind === 'poiType') {
    // Find all open POIs of the requested type
    const candidates = pois.filter((p) => {
      const effectiveStatus = poiStatus[p.id] ?? p.status;
      return p.type === query.poiType && effectiveStatus === 'open';
    });

    if (candidates.length === 0) return { error: 'no_matching_poi' };

    // Rank by unweighted graph distance to their nearestZone
    let bestZoneId: string | null = null;
    let bestDist = Infinity;

    for (const poi of candidates) {
      const d = shortestDistance(distGraph, originZoneId, poi.nearestZone);
      if (d < bestDist) {
        bestDist = d;
        bestZoneId = poi.nearestZone;
      }
    }

    if (bestZoneId === null) return { error: 'no_matching_poi' };
    return bestZoneId;
  }

  if (query.kind === 'nearestExit') {
    // Collect gate zones; prefer open over congested, exclude closed
    const openGates: Zone[] = [];
    const congestedGates: Zone[] = [];

    for (const z of zones) {
      if (z.type !== 'gate') continue;
      const status = gateStatus[z.id] ?? 'open';
      if (status === 'closed') continue;
      if (status === 'open') openGates.push(z);
      else congestedGates.push(z);
    }

    // Try open gates first, then congested
    const candidates = openGates.length > 0 ? openGates : congestedGates;
    if (candidates.length === 0) return { error: 'no_open_exit' };

    let bestZoneId: string | null = null;
    let bestDist = Infinity;

    for (const gate of candidates) {
      const d = shortestDistance(distGraph, originZoneId, gate.id);
      if (d < bestDist) {
        bestDist = d;
        bestZoneId = gate.id;
      }
    }

    if (bestZoneId === null) return { error: 'no_open_exit' };
    return bestZoneId;
  }

  // TypeScript exhaustiveness guard
  return { error: 'unknown_zone' };
}
