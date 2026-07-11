import type { Alert, FanContext, Zone, Poi } from '../types';
import { ZONES, POIS } from '../venue/venue';

export interface TriageInput {
  matchClockSec: number;
  density: Record<string, number>;
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
  fanContext: FanContext;
  alreadyFired: Record<string, number>; // triggerKey -> matchClockSec last fired
}

// Pure type definitions matching M3 routing contract (to avoid importing the module directly)
export type RouteResult = {
  path: string[];
  etaSec: number;
  reason: {
    crowdedZones: string[];
    avoidedGates: string[];
    etaSec: number;
  };
  accessible: boolean;
};

export type RouteError = { error: string };

export type DestinationQuery =
  | { kind: 'zone'; zoneId: string }
  | { kind: 'poiType'; poiType: 'restroom' | 'restroom_accessible' | 'water' | 'food' | 'first_aid' | 'atm' | 'merch' | 'info' | 'stairs' | 'elevator' | 'exit' | 'security' | 'recycling' | 'qr_beacon' }
  | { kind: 'nearestExit' };

export type RouteFilters = {
  accessibleOnly?: boolean;
  avoidEnclosed?: boolean;
  maxNoise?: 'low' | 'med' | 'high';
  avoidAffiliation?: 'home' | 'away';
};

/**
 * Pure trigger evaluation function.
 * Evaluates match states, crowd dynamics, and fan contexts to produce proactive alerts.
 *
 * Short-circuits:
 *   Expensive Dijkstra (computeRouteFn) is ONLY called when the non-routing preconditions
 *   are met (clock windows, leavingEarly flags, etc.).
 *
 * Call count bounds:
 *   In the absolute worst case per tick, computeRouteFn is called at most twice:
 *   - Once for exit-nudge (only during matchClockSec [5700, 6300])
 *   - Once for transit-nudge (only when leavingEarly is true)
 *   - Halftime concourse nudge uses static geometry and current density, requiring ZERO routing calls.
 */
export function evaluateTriggers(
  input: TriageInput,
  computeRouteFn: (
    origin: string,
    dest: DestinationQuery,
    filters?: RouteFilters
  ) => RouteResult | RouteError
): Array<{
  triggerKey: string;
  alert: Omit<Alert, 'id' | 'createdAt'>;
}> {
  const { matchClockSec, density, gateStatus, fanContext } = input;
  const location = fanContext.location;
  if (!location) return [];

  const alerts: Array<{ triggerKey: string; alert: Omit<Alert, 'id' | 'createdAt'> }> = [];

  // -------------------------------------------------------------------------
  // Rule 1: Pre-emptive exit nudge
  // -------------------------------------------------------------------------
  // Late game window: final 10 minutes of regulation (matchClockSec [5700, 6300])
  if (matchClockSec >= 5700 && matchClockSec <= 6300) {
    // Run nearestExit routing to evaluate if nearest gate is congested
    const route = computeRouteFn(location, { kind: 'nearestExit' });
    if (!('error' in route)) {
      const nearestGateId = [...route.path].reverse().find((id) => id.startsWith('gate-'));
      if (nearestGateId && (density[nearestGateId] ?? 0) > 0.7) {
        // Suggest leaving now via the currently-clearest open/congested gate
        const clGateId = getClearestGate(density, gateStatus);
        if (clGateId) {
          const clGateLabel = clGateId.replace('gate-', '').toUpperCase();
          alerts.push({
            triggerKey: 'exit-nudge',
            alert: {
              kind: 'proactive',
              priority: 2,
              title: 'Beat the Exit Rush',
              body: `Gate ${clGateLabel} is currently less crowded. Nudging to leave now via this gate.`,
              zoneId: clGateId,
              action: 'Show route',
            },
          });
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rule 2: Transit nudge
  // -------------------------------------------------------------------------
  // Fires only when leavingEarly is true
  if (fanContext.leavingEarly) {
    const route = computeRouteFn(location, { kind: 'zone', zoneId: 'transit-train' });
    if (!('error' in route)) {
      const etaSec = route.etaSec;
      const arrivalTime = matchClockSec + etaSec;

      // Mock train schedule: train departs every 15 minutes (900s) starting from kickoff (0s)
      const departureInterval = 900;
      const nextDepartureTime = Math.ceil(matchClockSec / departureInterval) * departureInterval;

      // Buffer check: if next train departs within N = 5 minutes (300s) of projected arrival,
      // and we can make it if we leave now (arrivalTime <= T_next).
      if (arrivalTime <= nextDepartureTime && nextDepartureTime <= arrivalTime + 300) {
        const depMin = Math.floor(nextDepartureTime / 60);
        alerts.push({
          triggerKey: 'transit-nudge',
          alert: {
            kind: 'proactive',
            priority: 2,
            title: 'Catch the Train',
            body: `Leave now to catch the next train departing soon at minute ${depMin}.`,
            zoneId: 'transit-train',
            action: 'Show route',
          },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Rule 3: Halftime concourse nudge
  // -------------------------------------------------------------------------
  // Halftime window: match clock phase 'half' (matchClockSec [2700, 3600])
  if (matchClockSec >= 2700 && matchClockSec < 3600) {
    // Find nearest restroom POI using static coordinate calculations (Dijkstra count: 0)
    const nearestRestroom = getNearestPoi(location, 'restroom');
    if (nearestRestroom) {
      const poiZone = nearestRestroom.nearestZone;
      const poiDensity = density[poiZone] ?? 0;

      // If the target POI's zone is clear (< 0.4), proactively suggest visiting it
      if (poiDensity < 0.4) {
        alerts.push({
          triggerKey: 'halftime-nudge',
          alert: {
            kind: 'proactive',
            priority: 3,
            title: 'Avoid Restroom Rush',
            body: `Heading to restroom ${nearestRestroom.label} now is recommended before concourse crowding increases.`,
            zoneId: poiZone,
            action: 'Show route',
          },
        });
      }
    }
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

function getClearestGate(
  density: Record<string, number>,
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>
): string | null {
  let clearestGate: string | null = null;
  let minDensity = Infinity;

  const exitGates = ['gate-a', 'gate-b', 'gate-c', 'gate-d'];
  for (const gate of exitGates) {
    if (gateStatus[gate] && gateStatus[gate] !== 'closed') {
      const gDensity = density[gate] ?? 0;
      if (gDensity < minDensity) {
        minDensity = gDensity;
        clearestGate = gate;
      }
    }
  }
  return clearestGate;
}

function getNearestPoi(location: string, type: 'restroom' | 'food'): Poi | null {
  const originZone = ZONES.find((z) => z.id === location);
  if (!originZone) return null;

  let nearestPoi: Poi | null = null;
  let minDistance = Infinity;

  const candidatePois = POIS.filter((p) => p.type === type && p.status !== 'closed');
  for (const poi of candidatePois) {
    const dist = getCoordinatesDistance(originZone, poi.angle, poi.r);
    if (dist < minDistance) {
      minDistance = dist;
      nearestPoi = poi;
    }
  }
  return nearestPoi;
}

function getCoordinatesDistance(zone: Zone, targetAngle: number, targetR: number): number {
  const angle = zone.angle ?? 0;
  const rInner = zone.rInner ?? 0;
  const rOuter = zone.rOuter ?? 0;
  const r = (rInner + rOuter) / 2;

  // Angular difference clamped to [0, 180]
  const diffAngle = Math.min(Math.abs(angle - targetAngle), 360 - Math.abs(angle - targetAngle));
  const diffR = Math.abs(r - targetR);

  // Weigh angular difference highly for concentric stand routing layout
  return diffAngle * 2.5 + diffR;
}
