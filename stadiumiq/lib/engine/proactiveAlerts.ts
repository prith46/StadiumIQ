import { Alert, FanContext } from '../types';
import { DensityFrame, forecastAt, findPeakCrush } from './forecast';
import { DestinationQuery, RouteFilters, RouteResult, RouteError } from './alertTriage';

export interface ProactiveAlertInput {
  matchClockSec: number;
  density: Record<string, number>;
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
  fanContext: FanContext;
  timeline: DensityFrame[];
  currentRoute?: { path: string[]; etaSec: number; targetGate: string };
  forecastHorizonSec?: number; // default 900 (15 min)
  dismissedAlertIds: Set<string>;
  computeRouteFn?: (
    origin: string,
    dest: DestinationQuery,
    filters?: RouteFilters
  ) => RouteResult | RouteError;
}

function isAlertDismissed(alertId: string, dismissedAlertIds: Set<string>): boolean {
  for (const id of dismissedAlertIds) {
    if (id === alertId || id.startsWith(`alert-${alertId}-`) || id.includes(alertId)) {
      return true;
    }
  }
  return false;
}

/**
 * Pure trigger evaluation function for proactive exit alerts.
 * Watches the match clock, crowd density forecasts, and fan context to push alerts.
 */
export function evaluateProactiveAlerts(input: ProactiveAlertInput): Alert[] {
  const {
    matchClockSec,
    density,
    gateStatus,
    fanContext,
    timeline,
    currentRoute,
    forecastHorizonSec = 900,
    dismissedAlertIds,
    computeRouteFn,
  } = input;

  const alerts: Alert[] = [];
  const location = fanContext.location;
  if (!location) {
    return [];
  }

  // ---------------------------------------------------------------------------
  // Trigger 1: Forecasted Congestion (Beat-the-Rush Nudge)
  // ---------------------------------------------------------------------------
  const isLateGame = matchClockSec >= 5700 && matchClockSec <= 6300;
  const isEligibleForExitAlerts = isLateGame || fanContext.leavingEarly;

  if (isEligibleForExitAlerts && currentRoute && currentRoute.targetGate && computeRouteFn) {
    const targetGate = currentRoute.targetGate;
    const forecast = forecastAt(timeline, matchClockSec, forecastHorizonSec);
    const predictedDensity = forecast.density?.[targetGate] ?? 0;

    if (predictedDensity >= 0.67) {
      const alertId = `proactive-exitalert-${targetGate}-congestion`;

      if (!isAlertDismissed(alertId, dismissedAlertIds)) {
        // Find the best alternative open gate
        let bestAltGate: string | null = null;
        let minAltEta = Infinity;

        const exitGates = ['gate-a', 'gate-b', 'gate-c', 'gate-d'];
        for (const gate of exitGates) {
          if (gate !== targetGate && gateStatus[gate] && gateStatus[gate] !== 'closed') {
            const altRoute = computeRouteFn(location, { kind: 'zone', zoneId: gate });
            if (!('error' in altRoute)) {
              if (altRoute.etaSec < minAltEta) {
                minAltEta = altRoute.etaSec;
                bestAltGate = gate;
              }
            }
          }
        }

        if (bestAltGate) {
          const targetLabel = targetGate.replace('gate-', '').toUpperCase();
          const altLabel = bestAltGate.replace('gate-', '').toUpperCase();
          const timeSavingsMin = Math.round((currentRoute.etaSec - minAltEta) / 60);

          let bodyText = `Gate ${targetLabel} is predicted to be congested. Re-routing via Gate ${altLabel} is recommended.`;
          if (timeSavingsMin > 0) {
            bodyText = `Gate ${targetLabel} is predicted to be congested. Re-routing via Gate ${altLabel} is ${timeSavingsMin}m faster.`;
          }

          alerts.push({
            id: alertId,
            kind: 'proactive',
            priority: 2,
            title: 'Beat the Exit Rush',
            body: bodyText,
            zoneId: bestAltGate,
            action: 'Show route',
            createdAt: matchClockSec,
          });
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Trigger 2: Egress-Risk Window
  // ---------------------------------------------------------------------------
  const isHalftime = matchClockSec >= 2700 && matchClockSec < 3600;
  const isEgressRiskWindow = isHalftime || isLateGame;

  if (isEgressRiskWindow) {
    // Check if peak crush is imminent within the next 15 minutes (900 seconds)
    // We search over a 40-minute horizon (2400 seconds)
    const peakCrush = findPeakCrush(timeline, matchClockSec, 2400);
    const peakAtSec = peakCrush.peakAtSec ?? 0;
    const isPeakCrushImminent = peakAtSec > matchClockSec && peakAtSec <= matchClockSec + forecastHorizonSec;

    // Egress peak crush warning only applies during the late-game window
    const isEgressPeakCrushImminent = isLateGame && isPeakCrushImminent;

    if (fanContext.leavingEarly || isEgressPeakCrushImminent) {
      const windowType = isHalftime ? 'halftime' : 'late-game';
      const alertId = `proactive-exitalert-egress-risk-${windowType}`;

      if (!isAlertDismissed(alertId, dismissedAlertIds)) {
        const bodyText = fanContext.leavingEarly
          ? 'You indicated leaving early. Starting exit flow now is recommended to avoid heavy gate queueing.'
          : 'High crowd density peak is imminent. Heading to exit now is recommended to beat the queue.';

        alerts.push({
          id: alertId,
          kind: 'proactive',
          priority: 1, // High priority
          title: isHalftime ? 'Halftime Exit Recommendation' : 'Egress Peak Warning',
          body: bodyText,
          zoneId: currentRoute?.targetGate,
          action: currentRoute ? 'Show route' : undefined,
          createdAt: matchClockSec,
        });
      }
    }
  }

  // Sort by priority (Priority 1 = highest, Priority 2 = medium, etc.)
  alerts.sort((a, b) => a.priority - b.priority);

  return alerts;
}
