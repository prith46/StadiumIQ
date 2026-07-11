import { useSimStore } from '../store/simStore';
import { useIncentiveStore } from '../store/incentiveStore';
import { detectBottlenecks, IncentiveTriageInput } from './incentiveTriage';
import { computeRoute } from './routing';
import { sensoryToRouteFilters } from './sensoryFilters';
import { EDGES, ZONES, POIS } from '../venue/venue';
import type { Incentive, Poi } from '../types';

const CONGESTION_THRESHOLD = 0.7;

/**
 * Store-reading glue that binds bottleneck detection to incentive creation and Zustand stores.
 * Filters POIs near bottlenecks and validates reroutes using M3/M8 routing engines.
 */
export function runIncentiveTriageService(): void {
  const simState = useSimStore.getState();
  const incentiveState = useIncentiveStore.getState();

  const { matchClockSec, density, gateStatus, routedLoad, fanContext } = simState;

  // Reroutes offered to the fan must respect their persistent sensory
  // preferences, same mapping/precedence as the F4 tool adapter and alertService.
  const sensoryFilters = sensoryToRouteFilters(fanContext.sensory);

  // 1. Run bottleneck detection triage
  const triageInput: IncentiveTriageInput = {
    matchClockSec,
    density,
    routedLoad,
    gateStatus,
    alreadyOffered: incentiveState.alreadyOffered,
  };

  const bottleneckZones = detectBottlenecks(triageInput);

  // 2. Process each bottleneck zone to find suitable rewards
  for (const bottleneckId of bottleneckZones) {
    const eligiblePois = POIS.filter(
      (p) => (p.type === 'food' || p.type === 'merch') && p.status === 'open'
    );

    let bestPoi: Poi | null = null;
    let bestWalkSec = Infinity;

    for (const poi of eligiblePois) {
      // Don't offer a POI located at the bottleneck itself
      if (poi.nearestZone === bottleneckId) {
        continue;
      }

      // Compute route from bottleneck zone to the POI's nearest zone
      const route = computeRoute(
        bottleneckId,
        poi.nearestZone,
        EDGES,
        ZONES,
        density,
        routedLoad,
        gateStatus,
        sensoryFilters
      );

      if ('error' in route) {
        continue;
      }

      // "Escape one bottleneck into another" Guard:
      // Verify that the route path does not pass through any other congested gates or concourses.
      // We check all nodes in path excluding the starting bottleneck and the target zone.
      const pathNodes = route.path;
      let passesThroughCongestion = false;

      for (let i = 1; i < pathNodes.length; i++) {
        const nodeId = pathNodes[i];
        const nodeDensity = density[nodeId] ?? 0;
        const nodeGateStatus = gateStatus[nodeId] ?? 'open';
        
        if (nodeDensity > CONGESTION_THRESHOLD || nodeGateStatus === 'congested') {
          passesThroughCongestion = true;
          break;
        }
      }

      if (passesThroughCongestion) {
        continue;
      }

      // Find the nearest eligible POI by walk time
      if (route.etaSec < bestWalkSec) {
        bestWalkSec = route.etaSec;
        bestPoi = poi;
      }
    }

    // 3. If a valid destination is found, construct and offer the incentive
    if (bestPoi) {
      const rewardString = `10% off concession at ${bestPoi.label}`;
      const expiresAt = matchClockSec + 300; // 5-minute sim clock expiry

      const qrPayload = JSON.stringify({
        v: 1,
        type: 'incentive',
        from: bottleneckId,
        to: bestPoi.nearestZone,
        reward: rewardString,
      });

      const incentiveData: Omit<Incentive, 'id'> = {
        fromZone: bottleneckId,
        toZone: bestPoi.nearestZone,
        reward: rewardString,
        qrPayload,
        expiresAt,
      };

      // Dispatches to sibling store (enforces cooldown internally)
      useIncentiveStore.getState().offerIncentive(incentiveData, matchClockSec);
    }
  }
}
