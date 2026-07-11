import { ZONES } from '../venue/venue';
import { routedLoadPenalty } from './loadBalance';
import type { Incentive, FanContext } from '../types';

export interface SmartBribeInput {
  matchClockSec: number;
  density: Record<string, number>;
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
  routedLoad: Record<string, number>;
  fanContext: FanContext;
  activeIncentiveIds: Set<string>;      // session/global-scoped to prevent duplicates
  expiryDurationSec?: number;           // default 600 (10 min)
}

/**
 * Pure helper: builds the qrPayload string deterministically from incentive fields.
 */
export function buildIncentiveQrPayload(incentive: Omit<Incentive, 'qrPayload'>): string {
  return JSON.stringify({
    v: 1,
    type: 'incentive',
    from: incentive.fromZone,
    to: incentive.toZone,
    reward: incentive.reward,
  });
}

/**
 * Pure, synchronous, deterministic bottleneck check and incentive evaluator.
 * Identifies gates that are busy (density >= 0.67) and congested or have high load feedback,
 * selects the least loaded open/non-congested alternative gate, and offers time-limited rewards.
 */
export function evaluateSmartBribe(input: SmartBribeInput): Incentive[] {
  const {
    matchClockSec,
    density,
    gateStatus,
    routedLoad,
    activeIncentiveIds,
    expiryDurationSec = 600,
  } = input;

  const incentives: Incentive[] = [];

  // Filter open gates and compute mean load for bottleneck check
  const openGates = ZONES.filter(
    (z) => z.type === 'gate' && gateStatus[z.id] !== 'closed'
  );

  let meanGateLoad = 0;
  if (openGates.length > 0) {
    const totalLoad = openGates.reduce((sum, g) => sum + (routedLoad[g.id] ?? 0), 0);
    meanGateLoad = totalLoad / openGates.length;
  }

  // Find all bottleneck gates
  const bottleneckGates = ZONES.filter(
    (z) => z.type === 'gate' && gateStatus[z.id] !== 'closed'
  ).filter((gate) => {
    const d = density[gate.id] ?? 0;
    if (d < 0.67) return false;

    const status = gateStatus[gate.id] ?? 'open';
    const isCongested = status === 'congested';
    const load = routedLoad[gate.id] ?? 0;
    const isRoutedLoadElevated = load > 1.5 * meanGateLoad && load >= 2;

    return isCongested || isRoutedLoadElevated;
  });

  // For each bottleneck, try to offer an incentive to reroute to a load-balanced alternative gate
  for (const bottleneck of bottleneckGates) {
    // Candidates for alternative gate: must be type === 'gate', status === 'open' (not 'congested' or 'closed'), and not the bottleneck itself
    const altGateCandidates = ZONES.filter(
      (z) => z.type === 'gate' && z.id !== bottleneck.id && gateStatus[z.id] === 'open'
    );

    if (altGateCandidates.length === 0) {
      continue;
    }

    // Sort by routedLoadPenalty to pick the one with the lowest virtual load
    let bestAltGate = altGateCandidates[0];
    let minPenalty = Infinity;

    for (const cand of altGateCandidates) {
      const penalty = routedLoadPenalty(routedLoad, cand.id);
      if (penalty < minPenalty) {
        minPenalty = penalty;
        bestAltGate = cand;
      } else if (penalty === minPenalty) {
        // Deterministic tie-breaker
        if (cand.id < bestAltGate.id) {
          bestAltGate = cand;
        }
      }
    }

    const fromZone = bottleneck.id;
    const toZone = bestAltGate.id;
    const id = `incentive-${fromZone}-${toZone}-${Math.floor(matchClockSec / 60)}`;

    if (activeIncentiveIds.has(id)) {
      continue;
    }

    const reward = `10% off at concession near ${bestAltGate.label}`;
    const expiresAt = matchClockSec + expiryDurationSec;

    const incentiveData = {
      id,
      fromZone,
      toZone,
      reward,
      expiresAt,
    };

    const qrPayload = buildIncentiveQrPayload(incentiveData);

    incentives.push({
      ...incentiveData,
      qrPayload,
    });
  }

  return incentives;
}
