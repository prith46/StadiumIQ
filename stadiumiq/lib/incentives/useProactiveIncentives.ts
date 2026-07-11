import { useEffect } from 'react';
import { useSimStore } from '../store/simStore';
import { useIncentiveStore } from '../store/incentiveStore';
import { runIncentiveTriageService } from '../engine/incentiveService';

/**
 * useProactiveIncentives.ts
 *
 * Ticks alongside F3's simulation clock by subscribing to `matchClockSec`.
 * Runs incentive service to trigger and offer new incentives on the sibling store.
 *
 * NO secondary setInterval/timer is created.
 */
export function useProactiveIncentives() {
  const matchClockSec = useSimStore((s) => s.matchClockSec);
  const location = useSimStore((s) => s.fanContext.location);

  // Subscribe to the activeIncentives array in useIncentiveStore
  const activeIncentives = useIncentiveStore((s) => s.activeIncentives);

  // Run the incentive triage on every clock tick change
  useEffect(() => {
    if (!location) return;

    // Evaluates bottlenecks and updates useIncentiveStore
    runIncentiveTriageService();
  }, [matchClockSec, location]);

  return activeIncentives;
}
