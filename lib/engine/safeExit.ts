import { computeRoute } from './routing';
import { EDGES, ZONES, GATES } from '../venue/venue';

export interface SafeExitInput {
  fromZoneId: string;
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
  density: Record<string, number>;
  routedLoad: Record<string, number>;
  accessibleOnly: boolean;
}

export interface SafeExitResult {
  path: string[] | null;
  etaSec: number | null;
  targetGate: string | null;
}

/**
 * Pure function that computes the safest (least congested/quickest) exit gate.
 * Reuses the existing Dijkstra logic in computeRoute() from M3.
 * Excludes closed gates entirely and honors accessibleOnly filters if requested.
 */
export function computeSafestExit(input: SafeExitInput): SafeExitResult {
  const { fromZoneId, gateStatus, density, routedLoad, accessibleOnly } = input;

  // Filter out candidate gates that are closed
  const candidateGates = GATES.filter((gateId) => {
    return gateStatus[gateId] !== 'closed';
  });

  if (candidateGates.length === 0) {
    return { path: null, etaSec: null, targetGate: null };
  }

  let bestRoute: { path: string[]; etaSec: number; targetGate: string } | null = null;

  for (const gateId of candidateGates) {
    const routeRes = computeRoute(
      fromZoneId,
      gateId,
      EDGES,
      ZONES,
      density,
      routedLoad,
      gateStatus,
      { accessibleOnly }
    );

    if (routeRes && !('error' in routeRes) && routeRes.path && routeRes.path.length > 0) {
      if (!bestRoute || routeRes.etaSec < bestRoute.etaSec) {
        bestRoute = {
          path: routeRes.path,
          etaSec: routeRes.etaSec,
          targetGate: gateId,
        };
      }
    }
  }

  if (!bestRoute) {
    return { path: null, etaSec: null, targetGate: null };
  }

  return {
    path: bestRoute.path,
    etaSec: bestRoute.etaSec,
    targetGate: bestRoute.targetGate,
  };
}
