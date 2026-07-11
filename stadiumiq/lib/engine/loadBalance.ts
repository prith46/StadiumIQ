export interface LoadBalanceInput {
  routedLoad: Record<string, number>;
  gateId: string;
}

/**
 * Pure function: returns the virtual congestion penalty contributed by routedLoad
 * for a given gate, to be added into the routing cost function alongside real density.
 */
export function routedLoadPenalty(routedLoad: Record<string, number>, gateId: string): number {
  const load = routedLoad[gateId] ?? 0;
  return 0.15 * Math.min(load, 10);
}

/**
 * Pure function: returns updated routedLoad after incrementing the chosen gate.
 * Returns a new object without mutating the input.
 */
export function incrementRoutedLoad(
  routedLoad: Record<string, number>,
  gateId: string
): Record<string, number> {
  const current = routedLoad[gateId] ?? 0;
  return {
    ...routedLoad,
    [gateId]: current + 1,
  };
}

/**
 * Pure function: applies the decay policy to routedLoad.
 * Values below 0.01 are pruned/removed from the returned state object.
 */
export function decayRoutedLoad(
  routedLoad: Record<string, number>,
  decayFactor: number = 0.9
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, val] of Object.entries(routedLoad)) {
    const decayed = val * decayFactor;
    if (decayed >= 0.01) {
      next[key] = decayed;
    }
  }
  return next;
}
