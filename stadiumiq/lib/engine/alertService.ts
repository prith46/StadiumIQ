import { useSimStore } from '../store/simStore';
import { useAlertStore } from '../store/alertStore';
import { evaluateTriggers, TriageInput, DestinationQuery, RouteFilters, RouteResult, RouteError } from './alertTriage';
import { resolveDestination } from './destinationResolver';
import { computeRoute } from './routing';
import { sensoryToRouteFilters } from './sensoryFilters';
import { EDGES, ZONES, POIS } from '../venue/venue';
import { computeSequencerState, LIVE_PHASE_END_SEC, PRE_MATCH_DURATION_SEC } from '../simulation/matchSequencer';
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

  // M29 (additive): only meaningful while the auto-sequencer is running and
  // in its 'live' phase — undefined otherwise, leaving Rule 0 a no-op.
  let secondsUntilPhaseEnd: number | undefined;
  if (simState.sequencerSeed !== null && simState.sequencerStartedAtMs !== null) {
    const seq = computeSequencerState(simState.sequencerSeed, simState.sequencerStartedAtMs, Date.now());
    if (seq.phase === 'live') {
      // Fix 6: matchClockSec is now baselined to 0 at live-phase start, so
      // the live phase's own duration (not the absolute LIVE_PHASE_END_SEC
      // elapsed-time boundary) is what's left to subtract from.
      secondsUntilPhaseEnd = (LIVE_PHASE_END_SEC - PRE_MATCH_DURATION_SEC) - seq.matchClockSec;
    }
  }

  const triageInput: TriageInput = {
    matchClockSec,
    density,
    gateStatus,
    fanContext,
    alreadyFired: alreadyFiredClocks,
    secondsUntilPhaseEnd,
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
      // M11 hard filter: an accessibility-flagged fan must never be routed
      // via stairs — same default as routingService and the F4 tool adapter.
      accessibleOnly: filters?.accessibleOnly ?? (fanContext.accessibility || undefined),
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
