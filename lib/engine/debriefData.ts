import type { SimState, Edge } from '../types';
import { traceRootCause, RootCauseChain } from './rootCause';
import { isBreachPredicted } from './dispatch';

// M27: how many peak-density zones to surface as "top bottlenecks".
const TOP_BOTTLENECK_COUNT = 3;

export interface DebriefBottleneck {
  zoneId: string;
  peakDensity: number;
  rootCause: RootCauseChain;
}

export interface DebriefIncidentStat {
  id: string;
  type: string;
  responseSec: number;
  breached: boolean;
}

export interface DebriefInput {
  topBottlenecks: DebriefBottleneck[];
  incidentStats: DebriefIncidentStat[];
}

/**
 * Pure, synchronous aggregation of real session data for the post-event
 * debrief — no LLM call here, just gathers and shapes data already collected
 * (`state.timeline`, the same frame history M23/M26 already read; no new
 * persistence). Root-cause chains reuse M25's `traceRootCause` unmodified.
 *
 * Note on `responseSec`: `Incident` has no persisted dispatched/resolved
 * timestamps, so there is no real wall/sim-clock delta to compute. The only
 * actual recorded response-time figure is `etaSec` — the graph-walk time
 * computed at dispatch (`lib/engine/dispatch.ts`) — so that real, non-
 * fabricated value is used here instead of inventing one. See
 * docs/STADIUMIQ-MASTER-DOCUMENTATION.md §4 (M27).
 */
export function aggregateDebriefData(state: SimState, edges: Edge[]): DebriefInput {
  const peakByZone = new Map<string, number>();

  for (const frame of state.timeline) {
    for (const [zoneId, value] of Object.entries(frame.density)) {
      const prev = peakByZone.get(zoneId);
      if (prev === undefined || value > prev) peakByZone.set(zoneId, value);
    }
  }
  for (const [zoneId, value] of Object.entries(state.density)) {
    const prev = peakByZone.get(zoneId);
    if (prev === undefined || value > prev) peakByZone.set(zoneId, value);
  }

  const topBottlenecks: DebriefBottleneck[] = Array.from(peakByZone.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_BOTTLENECK_COUNT)
    .map(([zoneId, peakDensity]) => ({
      zoneId,
      peakDensity,
      rootCause: traceRootCause(zoneId, state.timeline, state.gateStatus, state.incidents, edges),
    }));

  const incidentStats: DebriefIncidentStat[] = state.incidents
    .filter((inc) => inc.status === 'resolved' && inc.etaSec !== undefined)
    .map((inc) => ({
      id: inc.id,
      type: inc.type,
      responseSec: inc.etaSec as number,
      breached: isBreachPredicted(inc.etaSec as number),
    }));

  return { topBottlenecks, incidentStats };
}
