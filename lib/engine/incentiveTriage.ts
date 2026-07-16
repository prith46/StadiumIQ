import { ZONES } from '../venue/venue';

export interface IncentiveTriageInput {
  matchClockSec: number;
  density: Record<string, number>;
  routedLoad: Record<string, number>;   // M8's load signal
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
  alreadyOffered: Record<string, number>;  // zone -> matchClockSec last offered
}

const CONGESTION_THRESHOLD = 0.7;
const COOLDOWN_SEC = 300; // 5 minutes simulation clock cooldown

/**
 * Pure, synchronous triage function to detect bottleneck zones eligible for incentives.
 * Checks gates and concourses for live density congestion, and gates for predictive load imbalance.
 */
export function detectBottlenecks(input: IncentiveTriageInput): string[] {
  const { matchClockSec, density, routedLoad, gateStatus, alreadyOffered } = input;

  // 1. Filter open gates and compute mean load for predictive balancing
  const openGates = ZONES.filter(
    (z) => z.type === 'gate' && gateStatus[z.id] !== 'closed'
  );

  let meanGateLoad = 0;
  if (openGates.length > 0) {
    const totalLoad = openGates.reduce((sum, g) => sum + (routedLoad[g.id] ?? 0), 0);
    meanGateLoad = totalLoad / openGates.length;
  }

  const bottlenecks: string[] = [];

  // 2. Scan all gate and concourse zones
  const candidateZones = ZONES.filter(
    (z) => z.type === 'gate' || z.type === 'concourse'
  );

  for (const zone of candidateZones) {
    const zoneId = zone.id;

    // Check cooldown first to short-circuit
    const lastOffered = alreadyOffered[zoneId];
    if (lastOffered !== undefined && matchClockSec - lastOffered <= COOLDOWN_SEC) {
      continue;
    }

    let isBottleneck = false;

    // A. Density trigger (all concourses and gates)
    const d = density[zoneId] ?? 0;
    if (d > CONGESTION_THRESHOLD) {
      isBottleneck = true;
    }

    // B. Predictive routedLoad trigger (gates only)
    if (zone.type === 'gate' && !isBottleneck && gateStatus[zoneId] !== 'closed') {
      const load = routedLoad[zoneId] ?? 0;
      // Triggers if load is > 1.5x the mean gate load, and has a minimum load of 2
      if (load > 1.5 * meanGateLoad && load >= 2) {
        isBottleneck = true;
      }
    }

    if (isBottleneck) {
      bottlenecks.push(zoneId);
    }
  }

  return bottlenecks;
}
