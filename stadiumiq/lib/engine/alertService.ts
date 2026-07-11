import { useSimStore } from '../store/simStore';
import { useAlertStore } from '../store/alertStore';
import { evaluateTriggers, TriageInput, DestinationQuery, RouteFilters, RouteResult, RouteError } from './alertTriage';
import { resolveDestination } from './destinationResolver';
import { computeRoute } from './routing';
import { sensoryToRouteFilters } from './sensoryFilters';
import { EDGES, ZONES, POIS } from '../venue/venue';
import type { Alert, Poi } from '../types';

/**
 * alertService.ts
 *
 * Store-reading glue that binds the pure evaluateTriggers triage engine to the
 * Zustand simStore and M3 routing engines.
 *
 * This is the ONLY alert-related engine file that imports from Zustand or
 * standard routing engine modules.
 */

export function runAlertTriageService(): Array<{
  triggerKey: string;
  alert: Omit<Alert, 'id' | 'createdAt'>;
}> {
  const simState = useSimStore.getState();
  const alertState = useAlertStore.getState();

  const { matchClockSec, density, gateStatus, fanContext } = simState;

  // Build the TriageInput structure (extracting lastFiredAt clocks from alertStore's alreadyFired)
  const alreadyFiredClocks: Record<string, number> = {};
  for (const [key, val] of Object.entries(alertState.alreadyFired)) {
    alreadyFiredClocks[key] = val.lastFiredAt;
  }

  const triageInput: TriageInput = {
    matchClockSec,
    density,
    gateStatus,
    fanContext,
    alreadyFired: alreadyFiredClocks,
  };

  // Injected computeRouteFn implementation linking pure triage to M3 routing
  const computeRouteFn = (
    origin: string,
    dest: DestinationQuery,
    filters?: RouteFilters
  ): RouteResult | RouteError => {
    // 1. Build static POI statuses
    const poiStatus: Record<string, Poi['status']> = {};
    for (const poi of POIS) {
      poiStatus[poi.id] = poi.status;
    }

    // 2. Resolve destination query
    const resolvedZoneId = resolveDestination(
      dest,
      origin,
      EDGES,
      ZONES,
      POIS,
      density,
      poiStatus,
      gateStatus
    );

    if (typeof resolvedZoneId !== 'string') {
      return { error: 'no_route_found' };
    }

    // 3. Merge the fan's persistent sensory preferences under any filters
    // this specific trigger call explicitly passed (same per-field precedence
    // rule as the F4 tool adapter in lib/ai/tools.ts).
    const persistentSensory = sensoryToRouteFilters(fanContext.sensory);
    const mergedFilters: RouteFilters = {
      accessibleOnly: filters?.accessibleOnly,
      avoidEnclosed: filters?.avoidEnclosed ?? persistentSensory.avoidEnclosed,
      maxNoise: filters?.maxNoise ?? persistentSensory.maxNoise,
      avoidAffiliation: filters?.avoidAffiliation ?? persistentSensory.avoidAffiliation,
    };

    // 4. Run pure routing pass
    const routeRes = computeRoute(
      origin,
      resolvedZoneId,
      EDGES,
      ZONES,
      density,
      simState.routedLoad,
      gateStatus,
      mergedFilters
    );

    if ('error' in routeRes) {
      return { error: routeRes.error };
    }

    return routeRes;
  };

  // Run pure triage evaluation
  return evaluateTriggers(triageInput, computeRouteFn);
}
