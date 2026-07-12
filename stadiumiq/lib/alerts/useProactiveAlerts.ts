import { useEffect, useMemo, useRef } from 'react';
import { useSimStore } from '../store/simStore';
import { useAlertStore } from '../store/alertStore';
import { runAlertTriageService } from '../engine/alertService';
import type { Alert } from '../types';

/**
 * useProactiveAlerts.ts
 *
 * Ticks alongside F3's simulation clock by subscribing to `matchClockSec`.
 * Runs the documented M6 alert triage service, throttled to run once every
 * 10 simulation seconds, and triggers alerts on the alertStore.
 *
 * Also surfaces active (non-resolved) `Incident`s as 'safety' alerts, derived
 * live from `useSimStore.incidents` rather than pushed through `fireAlert`.
 * Incidents already have their own pending/dispatched/resolved lifecycle
 * (created via GodMode/UploadPanel/DispatchQueue), so re-deriving from that
 * source of truth on every render is simpler and always correct — no
 * duplicate state, no cooldown bookkeeping to keep in sync. This is what
 * makes the Organizer Dashboard's "Operations Alerts Feed" (which reuses this
 * hook via AlertStack) actually reflect an active incident instead of always
 * showing "No active alerts". Deliberately NOT gated behind `location` like
 * the fan-triage effect below — an organizer session may have no fan
 * location set at all, and incident visibility shouldn't depend on it.
 */
export function useProactiveAlerts() {
  const matchClockSec = useSimStore((s) => s.matchClockSec);
  const location = useSimStore((s) => s.fanContext.location);
  const leavingEarly = useSimStore((s) => s.fanContext.leavingEarly);
  const incidents = useSimStore((s) => s.incidents);

  // Subscribe to the activeAlerts array in useAlertStore.
  const activeAlerts = useAlertStore((s) => s.activeAlerts);
  const fireAlert = useAlertStore((s) => s.fireAlert);

  const lastCheckedClockRef = useRef<number | null>(null);

  // Run the alerts triage on every clock tick change or fan context changes (throttled to 10s simulation time)
  useEffect(() => {
    if (!location) return;

    // Throttle evaluation to once every 10 simulation seconds
    if (lastCheckedClockRef.current !== null) {
      const delta = matchClockSec - lastCheckedClockRef.current;
      if (delta >= 0 && delta < 10) {
        return;
      }
    }
    lastCheckedClockRef.current = matchClockSec;

    // Run the documented alerts triage service
    const evaluatedExisting = runAlertTriageService();
    for (const item of evaluatedExisting) {
      fireAlert(item.triggerKey, item.alert, matchClockSec);
    }
  }, [matchClockSec, location, leavingEarly, fireAlert]);

  const incidentAlerts = useMemo<Alert[]>(() => {
    return incidents
      .filter((inc) => inc.status !== 'resolved')
      .map((inc) => ({
        id: `incident-alert-${inc.id}`,
        kind: 'safety' as const,
        priority: (inc.type === 'medical' || inc.type === 'evacuation' ? 1 : 2) as 1 | 2 | 3,
        title: `${inc.type.charAt(0).toUpperCase()}${inc.type.slice(1)} incident — ${inc.zoneId}`,
        body: inc.note || 'Reported incident requires attention.',
        zoneId: inc.zoneId,
        createdAt: inc.createdAt,
        action: 'Show on map',
      }));
  }, [incidents]);

  return useMemo(() => [...incidentAlerts, ...activeAlerts], [incidentAlerts, activeAlerts]);
}

