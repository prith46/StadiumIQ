import { useEffect, useRef } from 'react';
import { useSimStore } from '../store/simStore';
import { useIncentiveStore } from '../store/incentiveStore';
import { runIncentiveTriageService } from '../engine/incentiveService';

/**
 * useProactiveIncentives.ts
 *
 * Ticks alongside F3's simulation clock by subscribing to `matchClockSec`.
 * Runs incentive service to trigger and offer new incentives on the sibling
 * store, throttled to once every 10 simulation seconds — the triage runs
 * multiple Dijkstra passes over candidate POIs, so it uses the same throttle
 * as useProactiveAlerts rather than running on every tick.
 *
 * NO secondary setInterval/timer is created.
 */
export function useProactiveIncentives() {
  // 10-sim-second bucket subscription — same rationale as useProactiveAlerts:
  // the triage is throttled to 10 sim-seconds, so subscribing to the raw
  // clock only re-rendered the IncentiveStack on every 1s tick for nothing.
  const triageBucket = useSimStore((s) => Math.floor(s.matchClockSec / 10));
  const location = useSimStore((s) => s.fanContext.location);

  // Subscribe to the activeIncentives array in useIncentiveStore
  const activeIncentives = useIncentiveStore((s) => s.activeIncentives);

  const lastCheckedClockRef = useRef<number | null>(null);

  useEffect(() => {
    if (!location) return;

    const matchClockSec = useSimStore.getState().matchClockSec;

    // Throttle evaluation to once every 10 simulation seconds
    if (lastCheckedClockRef.current !== null) {
      const delta = matchClockSec - lastCheckedClockRef.current;
      if (delta >= 0 && delta < 10) {
        return;
      }
    }
    lastCheckedClockRef.current = matchClockSec;

    // Evaluates bottlenecks and updates useIncentiveStore
    runIncentiveTriageService();
  }, [triageBucket, location]);

  return activeIncentives;
}
