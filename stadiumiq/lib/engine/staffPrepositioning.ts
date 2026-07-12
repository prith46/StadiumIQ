import type { Edge, Responder } from '../types';
import { computeRoute } from './routing';
import { ZONES } from '../venue/venue';

// M24: default number of responders to recommend pre-positioning per hotspot.
export const DEFAULT_PREPOSITION_COUNT = 1;

export interface ForecastHotspot {
  zoneId: string;
  predictedCrossingSec: number;
}

export interface PrepositionRecommendation {
  responderId: string;
  fromZone: string;
  toZone: string;
  recommendedDepartSec: number;
  willArriveInTime: boolean;
}

/**
 * Graph-distance walk time between two zones, reusing the same Dijkstra
 * shortest-path (`computeRoute`) that M17's dispatch assignment is built on
 * — not reimplemented here. Neutral (empty) density/routedLoad/gateStatus are
 * passed since this is a forward-looking recommendation, not a live route.
 */
function travelTimeSec(fromZoneId: string, toZoneId: string, edges: Edge[]): number {
  const result = computeRoute(fromZoneId, toZoneId, edges, ZONES, {}, {}, {});
  if ('error' in result) return Infinity;
  return result.etaSec;
}

/**
 * Pure, synchronous staff pre-positioning recommendation: which idle
 * responder(s) should move toward a forecast hotspot, and by when, to arrive
 * before the predicted threshold crossing.
 */
export function recommendPrepositioning(
  forecastHotspot: ForecastHotspot,
  responders: Responder[],
  edges: Edge[],
  count: number = DEFAULT_PREPOSITION_COUNT
): PrepositionRecommendation[] {
  const idle = responders.filter((r) => r.available);
  if (idle.length === 0) return [];

  const scored = idle
    .map((responder) => ({
      responder,
      travelSec: travelTimeSec(responder.zoneId, forecastHotspot.zoneId, edges),
    }))
    .sort((a, b) => a.travelSec - b.travelSec);

  const chosenCount = Math.min(count, scored.length);

  return scored.slice(0, chosenCount).map(({ responder, travelSec }) => {
    const willArriveInTime = Number.isFinite(travelSec)
      && travelSec <= forecastHotspot.predictedCrossingSec;
    const recommendedDepartSec = Number.isFinite(travelSec)
      ? Math.max(0, forecastHotspot.predictedCrossingSec - travelSec)
      : forecastHotspot.predictedCrossingSec;

    return {
      responderId: responder.id,
      fromZone: responder.zoneId,
      toZone: forecastHotspot.zoneId,
      recommendedDepartSec,
      willArriveInTime,
    };
  });
}
