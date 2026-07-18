import type { DensityFrame, Edge, Incident } from '../types';
import {
  HOTSPOT_THRESHOLD,
  CASCADE_LOOKBACK_FRAMES,
  buildIncomingMap,
  computeFirstCrossings,
} from './cascadePrediction';

// Hard cap on upstream hops traced, to bound worst-case work on pathological
// adjacency loops. In practice CASCADE_LOOKBACK_FRAMES already bounds this.
const MAX_TRACE_HOPS = 10;

const BAD_GATE_STATUSES = new Set(['closed', 'congested']);

export interface CauseLink {
  label: string;
  zoneOrGateId: string;
  secondsAgo: number;
  // 'none' is a deliberate addition beyond the spec's 3-value union: it is
  // the only truthful way to represent "no fabricated cause" (see
  // docs/STADIUMIQ-MASTER-DOCUMENTATION.md §4 M25) while still returning a well-typed CauseLink.
  kind: 'gate_status' | 'incident' | 'adjacent_zone' | 'none';
}

export interface RootCauseChain {
  symptomZoneId: string;
  chain: CauseLink[];
}

interface CandidateCause {
  kind: 'gate_status' | 'incident' | 'adjacent_zone';
  zoneOrGateId: string;
  secondsAgo: number;
  label: string;
  nextZone?: string; // set only for 'adjacent_zone' — continue tracing from here
}

/**
 * Pure, synchronous backward trace from a congested zone to its earliest
 * identifiable upstream trigger. Reuses `cascadePrediction`'s adjacency map,
 * first-crossing detection, and `CASCADE_LOOKBACK_FRAMES` window — the same
 * causal logic M23 uses forward, walked backward here instead.
 */
export function traceRootCause(
  symptomZoneId: string,
  history: DensityFrame[],
  gateStatus: Record<string, string>,
  incidents: Incident[],
  edges: Edge[]
): RootCauseChain {
  if (history.length === 0) {
    return { symptomZoneId, chain: [noClearCauseLink(symptomZoneId, 0)] };
  }

  const nowSec = history[history.length - 1].atSec;
  const incomingMap = buildIncomingMap(edges);
  const { frameIdx: crossingFrameIdx, sec: crossingSec } = computeFirstCrossings(history, HOTSPOT_THRESHOLD);

  const links: CauseLink[] = [];
  const visited = new Set<string>([symptomZoneId]);
  let current = symptomZoneId;

  for (let hop = 0; hop < MAX_TRACE_HOPS; hop++) {
    const selfCause = findSelfCause(current, nowSec, gateStatus, incidents, history);
    if (selfCause) {
      links.push(toLink(selfCause));
      break;
    }

    const neighborCause = findNeighborCause(current, nowSec, gateStatus, incidents, history, incomingMap, crossingFrameIdx, crossingSec, visited);
    if (!neighborCause) break;

    links.push(toLink(neighborCause));

    if (neighborCause.kind !== 'adjacent_zone' || !neighborCause.nextZone) break;
    current = neighborCause.nextZone;
    visited.add(current);
  }

  if (links.length === 0) {
    links.push(noClearCauseLink(symptomZoneId, 0));
  }

  return { symptomZoneId, chain: links.reverse() };
}

function toLink(cause: CandidateCause): CauseLink {
  return { label: cause.label, zoneOrGateId: cause.zoneOrGateId, secondsAgo: cause.secondsAgo, kind: cause.kind };
}

function noClearCauseLink(symptomZoneId: string, secondsAgo: number): CauseLink {
  return {
    label: `No clear single trigger identified for ${symptomZoneId} — likely organic gradual buildup`,
    zoneOrGateId: symptomZoneId,
    secondsAgo,
    kind: 'none',
  };
}

/** Does `zoneId` itself directly explain its own congestion (incident, or it's a gate in a bad state)? */
function findSelfCause(
  zoneId: string,
  nowSec: number,
  gateStatus: Record<string, string>,
  incidents: Incident[],
  history: DensityFrame[]
): CandidateCause | null {
  const incidentCause = findIncidentCause(zoneId, nowSec, incidents);
  if (incidentCause) return incidentCause;

  return findGateCause(zoneId, nowSec, gateStatus, history);
}

function findIncidentCause(zoneId: string, nowSec: number, incidents: Incident[]): CandidateCause | null {
  const matches = incidents.filter((inc) => inc.zoneId === zoneId && inc.createdAt <= nowSec);
  if (matches.length === 0) return null;

  // Most recent qualifying incident is the most direct explanation.
  const latest = matches.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return {
    kind: 'incident',
    zoneOrGateId: zoneId,
    secondsAgo: nowSec - latest.createdAt,
    label: `${latest.type} incident reported at ${zoneId}`,
  };
}

function findGateCause(
  zoneId: string,
  nowSec: number,
  gateStatus: Record<string, string>,
  history: DensityFrame[]
): CandidateCause | null {
  const status = gateStatus[zoneId];
  if (!status || !BAD_GATE_STATUSES.has(status)) return null;

  // Walk backward from "now" while this gate's own historical status stays bad.
  let earliestBadFrame: DensityFrame | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const frame = history[i];
    const frameStatus = frame.gateStatus?.[zoneId];
    if (frameStatus && BAD_GATE_STATUSES.has(frameStatus)) {
      earliestBadFrame = frame;
    } else {
      break;
    }
  }

  const sinceSec = earliestBadFrame ? earliestBadFrame.atSec : nowSec;
  return {
    kind: 'gate_status',
    zoneOrGateId: zoneId,
    secondsAgo: Math.max(0, nowSec - sinceSec),
    label: `${zoneId} ${status}`,
  };
}

/** Does an upstream neighbor of `zoneId` explain its congestion? */
function findNeighborCause(
  zoneId: string,
  nowSec: number,
  gateStatus: Record<string, string>,
  incidents: Incident[],
  history: DensityFrame[],
  incomingMap: Map<string, string[]>,
  crossingFrameIdx: Map<string, number>,
  crossingSec: Map<string, number>,
  visited: Set<string>
): CandidateCause | null {
  const neighbors = (incomingMap.get(zoneId) ?? []).filter((n) => !visited.has(n));
  if (neighbors.length === 0) return null;

  const zoneCrossingIdx = crossingFrameIdx.get(zoneId);

  let best: CandidateCause | null = null;
  let bestPriority = -1; // incident=2, gate_status=1, adjacent_zone=0
  let bestSecondsAgo = -Infinity;

  for (const neighborId of neighbors) {
    let candidate: CandidateCause | null = findIncidentCause(neighborId, nowSec, incidents);
    let priority = 2;

    if (!candidate) {
      candidate = findGateCause(neighborId, nowSec, gateStatus, history);
      priority = 1;
    }

    if (!candidate) {
      const neighborCrossingIdx = crossingFrameIdx.get(neighborId);
      if (
        neighborCrossingIdx !== undefined &&
        zoneCrossingIdx !== undefined &&
        neighborCrossingIdx < zoneCrossingIdx &&
        zoneCrossingIdx - neighborCrossingIdx <= CASCADE_LOOKBACK_FRAMES
      ) {
        candidate = {
          kind: 'adjacent_zone',
          zoneOrGateId: neighborId,
          secondsAgo: nowSec - crossingSec.get(neighborId)!,
          label: `${neighborId} crossed congestion threshold`,
          nextZone: neighborId,
        };
        priority = 0;
      }
    }

    if (!candidate) continue;

    if (priority > bestPriority || (priority === bestPriority && candidate.secondsAgo < bestSecondsAgo)) {
      best = candidate;
      bestPriority = priority;
      bestSecondsAgo = candidate.secondsAgo;
    }
  }

  return best;
}
