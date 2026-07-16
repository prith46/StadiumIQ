import { useSimStore } from '../store/simStore';
import { useIncentiveStore } from '../store/incentiveStore';
import { detectBottlenecks, IncentiveTriageInput } from './incentiveTriage';
import { computeRoute, buildGraph, shortestDistance } from './routing';
import { sensoryToRouteFilters } from './sensoryFilters';
import { EDGES, ZONES, POIS } from '../venue/venue';
import type { Incentive, Poi } from '../types';

const CONGESTION_THRESHOLD = 0.7;

/**
 * Store-reading glue that binds bottleneck detection to incentive creation and Zustand stores.
 * Filters POIs near bottlenecks and validates reroutes using M3/M8 routing engines.
 *
 * Personalization (M9 §3): this is a single-fan client, so an incentive is only
 * relevant when it reflects a bottleneck actually near the fan's own location —
 * evaluating every bottleneck stadium-wide would offer every fan every gate's
 * incentive simultaneously, which is both wrong (route origin doesn't match
 * where the fan is) and the direct cause of unrelated-bottleneck stacking.
 */
export function runIncentiveTriageService(): void {
  const simState = useSimStore.getState();
  const incentiveState = useIncentiveStore.getState();

  const { matchClockSec, density, gateStatus, routedLoad, fanContext } = simState;
  const originZoneId = fanContext.location;

  // No known location yet (e.g. still onboarding) — nothing to personalize against.
  if (!originZoneId) return;

  // Reroutes offered to the fan must respect their persistent sensory
  // preferences, same mapping/precedence as the F4 tool adapter and alertService.
  // accessibleOnly is the M11 hard filter: never offer a stairs route to an
  // accessibility-flagged fan.
  const sensoryFilters = {
    ...sensoryToRouteFilters(fanContext.sensory),
    accessibleOnly: fanContext.accessibility || undefined,
  };

  // 1. Run bottleneck detection triage (stadium-wide candidate list)
  const triageInput: IncentiveTriageInput = {
    matchClockSec,
    density,
    routedLoad,
    gateStatus,
    alreadyOffered: incentiveState.alreadyOffered,
  };

  const bottleneckZones = detectBottlenecks(triageInput);
  if (bottleneckZones.length === 0) return;

  // 2. Narrow to the single bottleneck nearest the fan's current location —
  // that's the only one whose reroute is actually relevant to them.
  const distGraph = buildGraph(EDGES, ZONES, {}, {}, {}, {});
  let bottleneckId: string | null = null;
  let nearestDist = Infinity;
  for (const zoneId of bottleneckZones) {
    const d = shortestDistance(distGraph, originZoneId, zoneId);
    if (d < nearestDist) {
      nearestDist = d;
      bottleneckId = zoneId;
    }
  }
  if (bottleneckId === null) return;

  // 3. Find the best food/merch POI to reroute the fan to, validating the
  // actual route the fan would walk (from their real current location).
  const eligiblePois = POIS.filter(
    (p) => (p.type === 'food' || p.type === 'merch') && p.status === 'open'
  );

  // Every candidate below is routed against the SAME live state, so build the
  // weighted graph (and the naive comparison graph computeRoute may need)
  // ONCE per triage pass instead of once per POI — previously each candidate
  // paid a full graph construction plus up to three Dijkstra runs.
  const passGraphs = {
    weighted: buildGraph(EDGES, ZONES, sensoryFilters, gateStatus, density, routedLoad),
    naive: buildGraph(EDGES, ZONES, sensoryFilters, {}, {}, {}),
  };

  let bestPoi: Poi | null = null;
  let bestWalkSec = Infinity;

  for (const poi of eligiblePois) {
    // Don't offer a POI located at the bottleneck itself
    if (poi.nearestZone === bottleneckId) {
      continue;
    }

    // Compute the route the fan would actually take, from their real location.
    const route = computeRoute(
      originZoneId,
      poi.nearestZone,
      EDGES,
      ZONES,
      density,
      routedLoad,
      gateStatus,
      sensoryFilters,
      undefined,
      passGraphs
    );

    if ('error' in route) {
      continue;
    }

    // "Escape one bottleneck into another" Guard:
    // Verify that the route path does not pass through any other congested gates or concourses.
    // We check all nodes in path excluding the fan's starting zone and the target zone.
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

  // 4. If a valid destination is found, construct and offer the incentive.
  // fromZone is the fan's own current location — the offer, its QR payload, and
  // "View Clear Reroute" all must agree on where the reroute actually starts.
  if (bestPoi) {
    const rewardString = `10% off concession at ${bestPoi.label}`;
    const expiresAt = matchClockSec + 300; // 5-minute sim clock expiry

    const qrPayload = JSON.stringify({
      v: 1,
      type: 'incentive',
      from: originZoneId,
      to: bestPoi.nearestZone,
      reward: rewardString,
    });

    const incentiveData: Omit<Incentive, 'id'> = {
      fromZone: originZoneId,
      toZone: bestPoi.nearestZone,
      reward: rewardString,
      qrPayload,
      expiresAt,
    };

    // Dispatches to sibling store (enforces cooldown internally)
    useIncentiveStore.getState().offerIncentive(incentiveData, matchClockSec);
  }
}
