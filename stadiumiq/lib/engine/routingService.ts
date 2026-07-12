/**
 * lib/engine/routingService.ts
 *
 * Thin store-reading glue for M3 (Crowd-Aware Navigation).
 *
 * This is the ONLY file in lib/engine/ that imports from Zustand.
 * All other engine files (routing.ts, destinationResolver.ts) are pure functions.
 *
 * Responsibilities:
 *   1. Read live state (density, routedLoad, gateStatus, fanContext) from useSimStore
 *   2. Resolve the destination via resolveDestination()
 *   3. Call the pure computeRoute() function
 *   4. Call incrementRoutedLoad() exactly once on a successful route (§6.3)
 */

import { EDGES, ZONES, POIS } from '../venue/venue';
import { useSimStore } from '../store/simStore';
import { RouteFilters, RouteResult, RouteError, computeRoute } from './routing';
import { DestinationQuery, resolveDestination, ResolveError } from './destinationResolver';
import { sensoryToRouteFilters } from './sensoryFilters';
import { Poi } from '../types';

export type { DestinationQuery } from './destinationResolver';
export type { RouteFilters, RouteResult, RouteError } from './routing';

export type ServiceResult =
  | RouteResult
  | RouteError
  | ResolveError;

/**
 * Compute a crowd-aware route from the fan's current location (or an explicit
 * origin) to a destination query.
 *
 * Reads all live state from the Zustand store. Calls incrementRoutedLoad()
 * exactly once on success at the final gate/exit zone on the path.
 *
 * @param destination   What to route to (zone id, POI type, or nearest exit)
 * @param filters       Optional accessibility / sensory filters
 * @param originOverride  If provided, use this zone id as origin instead of fanContext.location
 */
export function computeServiceRoute(
  destination: DestinationQuery,
  filters?: RouteFilters,
  originOverride?: string
): ServiceResult {
  const state = useSimStore.getState();
  const { density, routedLoad, gateStatus, fanContext } = state;

  // Determine origin
  const originZoneId = originOverride ?? fanContext.location;
  if (!originZoneId) {
    return { error: 'no_route_found' };
  }

  // Build live POI status map (venue POIS are all static 'open' for now;
  // future modules can pass overrides via the store)
  const poiStatus: Record<string, Poi['status']> = {};
  for (const poi of POIS) {
    poiStatus[poi.id] = poi.status;
  }

  // Apply fanContext accessibility + persistent sensory preferences as default filters.
  // Caller-supplied filters take precedence field-by-field via ?? (same pattern as
  // alertService.ts:74-80, incentiveService.ts:23, tools.ts:195-202).
  const persistentSensory = sensoryToRouteFilters(fanContext.sensory);
  const effectiveFilters: RouteFilters = {
    accessibleOnly: fanContext.accessibility || filters?.accessibleOnly,
    avoidEnclosed: filters?.avoidEnclosed ?? persistentSensory.avoidEnclosed,
    maxNoise: filters?.maxNoise ?? persistentSensory.maxNoise,
    avoidAffiliation: filters?.avoidAffiliation ?? persistentSensory.avoidAffiliation,
  };

  // Resolve destination
  const resolvedZoneId = resolveDestination(
    destination,
    originZoneId,
    EDGES,
    ZONES,
    POIS,
    density,
    poiStatus,
    gateStatus,
    routedLoad
  );

  if (typeof resolvedZoneId !== 'string') {
    return resolvedZoneId; // ResolveError
  }

  // Run pure routing algorithm
  const result = computeRoute(
    originZoneId,
    resolvedZoneId,
    EDGES,
    ZONES,
    density,
    routedLoad,
    gateStatus,
    effectiveFilters
  );

  // §6.3: Increment routedLoad at the final gate/exit zone on a successful route
  if (!('error' in result)) {
    const path = result.path;
    // Find the last gate zone on the path (the exit point)
    const exitZone = [...path].reverse().find((id) => id.startsWith('gate-'));
    if (exitZone) {
      useSimStore.getState().incrementRoutedLoad(exitZone);
    }
  }

  return result;
}
