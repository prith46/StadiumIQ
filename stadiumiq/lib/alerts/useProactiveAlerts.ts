import { useEffect, useRef } from 'react';
import { useSimStore } from '../store/simStore';
import { useAlertStore } from '../store/alertStore';
import { runAlertTriageService } from '../engine/alertService';
import { evaluateProactiveAlerts } from '../engine/proactiveAlerts';
import { computeServiceRoute } from '../engine/routingService';
import { DestinationQuery, RouteFilters } from '../engine/alertTriage';

/**
 * useProactiveAlerts.ts
 *
 * Ticks alongside F3's simulation clock by subscribing to `matchClockSec`.
 * Runs alert triage service and triggers alerts firing on the alertStore.
 *
 * NO secondary setInterval/timer is created.
 */
export function useProactiveAlerts() {
  const matchClockSec = useSimStore((s) => s.matchClockSec);
  const location = useSimStore((s) => s.fanContext.location);
  const leavingEarly = useSimStore((s) => s.fanContext.leavingEarly);

  // Subscribe to the activeAlerts array in useAlertStore.
  const activeAlerts = useAlertStore((s) => s.activeAlerts);
  const fireAlert = useAlertStore((s) => s.fireAlert);

  const lastCheckedClockRef = useRef<number | null>(null);

  // Run the alerts triage on every clock tick change or fan context location/early-leaving change
  useEffect(() => {
    if (!location) return;

    // 1. Run the existing alerts triage on every clock tick change
    const evaluatedExisting = runAlertTriageService();
    for (const item of evaluatedExisting) {
      fireAlert(item.triggerKey, item.alert, matchClockSec);
    }

    // 2. Throttle M6 evaluation to once every 10 simulation seconds
    if (lastCheckedClockRef.current !== null) {
      const delta = matchClockSec - lastCheckedClockRef.current;
      if (delta >= 0 && delta < 10) {
        return;
      }
    }
    lastCheckedClockRef.current = matchClockSec;

    // 3. Run M6 Proactive Exit Alerts evaluation
    const dismissedAlertIds = new Set(useAlertStore.getState().dismissedAlertIds);

    // Get current route to the nearest exit to determine the target gate
    const currentRouteResult = computeServiceRoute({ kind: 'nearestExit' });
    let currentRoute: { path: string[]; etaSec: number; targetGate: string } | undefined = undefined;

    if (!('error' in currentRouteResult)) {
      const targetGate = [...currentRouteResult.path].reverse().find((id) => id.startsWith('gate-'));
      if (targetGate) {
        currentRoute = {
          path: currentRouteResult.path,
          etaSec: currentRouteResult.etaSec,
          targetGate,
        };
      }
    }

    const simState = useSimStore.getState();
    const { density, gateStatus, fanContext, timeline } = simState;

    const computeRouteFn = (origin: string, dest: DestinationQuery, filters?: RouteFilters) => {
      return computeServiceRoute(dest, filters, origin);
    };

    const proactiveAlerts = evaluateProactiveAlerts({
      matchClockSec,
      density,
      gateStatus,
      fanContext,
      timeline,
      currentRoute,
      dismissedAlertIds,
      computeRouteFn,
    });

    for (const alert of proactiveAlerts) {
      const { id, createdAt, ...alertData } = alert;
      fireAlert(id, alertData, matchClockSec);
    }
  }, [matchClockSec, location, leavingEarly, fireAlert]);

  return activeAlerts;
}

