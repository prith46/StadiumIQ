import type { Edge, Zone } from '../types';
import { computeRoute } from './routing';
import { resolveDestination, DestinationQuery } from './destinationResolver';

export interface LoadTestScenario {
  originZoneIds: string[];
  destinationQuery: DestinationQuery;
  requestOrder: 'sequential';
}

export interface LoadTestResult {
  gateDistribution: Record<string, number>;
  giniCoefficient: number;
  comparedToNaive: {
    naiveGiniCoefficient: number;
    improvementRatio: number; // naive / balanced
  };
}

/**
 * Calculates the Gini Coefficient for a set of values.
 * Represents inequality: 0 = perfect equality, 1 = maximum inequality.
 *
 * Gini = Sum_i Sum_j |x_i - x_j| / (2 * n * Sum_i x_i)
 */
export function calculateGini(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  
  const sum = values.reduce((acc, v) => acc + v, 0);
  if (sum === 0) return 0;

  let absDiffSum = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      absDiffSum += Math.abs(values[i] - values[j]);
    }
  }

  return absDiffSum / (2 * n * sum);
}

/**
 * Deterministically simulates sequential routing requests from multiple origins
 * to verify that herding load feedback effectively spreads recommended routes.
 *
 * Runs once with routing feedback (balanced) and once without feedback (naive).
 */
export function runLoadTestScenario(
  scenario: LoadTestScenario,
  edges: Edge[],
  zones: Zone[],
  density: Record<string, number> = {},
  gateStatus: Record<string, 'open' | 'congested' | 'closed'> = {}
): LoadTestResult {
  const exitGates = zones.filter((z) => z.type === 'gate').map((z) => z.id);

  // ---------------------------------------------------------------------------
  // 1. Naive Simulation Run (routedLoad locked at 0)
  // ---------------------------------------------------------------------------
  const naiveCounts: Record<string, number> = {};
  for (const gate of exitGates) naiveCounts[gate] = 0;

  for (const origin of scenario.originZoneIds) {
    const resolvedZoneId = resolveDestination(
      scenario.destinationQuery,
      origin,
      edges,
      zones,
      [], // pois
      density,
      {}, // poiStatus
      gateStatus,
      {}  // routedLoad locked at 0
    );

    if (typeof resolvedZoneId === 'string') {
      const route = computeRoute(
        origin,
        resolvedZoneId,
        edges,
        zones,
        density,
        {}, // routedLoad locked at 0
        gateStatus
      );

      if (!('error' in route)) {
        const gateOnPath = [...route.path].reverse().find((id) => id.startsWith('gate-'));
        if (gateOnPath && exitGates.includes(gateOnPath)) {
          naiveCounts[gateOnPath]++;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Balanced Simulation Run (routedLoad accumulates feedback)
  // ---------------------------------------------------------------------------
  const balancedCounts: Record<string, number> = {};
  for (const gate of exitGates) balancedCounts[gate] = 0;

  const accumulatedRoutedLoad: Record<string, number> = {};
  for (const origin of scenario.originZoneIds) {
    const resolvedZoneId = resolveDestination(
      scenario.destinationQuery,
      origin,
      edges,
      zones,
      [], // pois
      density,
      {}, // poiStatus
      gateStatus,
      accumulatedRoutedLoad // Pass active accumulated load
    );

    if (typeof resolvedZoneId === 'string') {
      const route = computeRoute(
        origin,
        resolvedZoneId,
        edges,
        zones,
        density,
        accumulatedRoutedLoad,
        gateStatus
      );

      if (!('error' in route)) {
        const gateOnPath = [...route.path].reverse().find((id) => id.startsWith('gate-'));
        if (gateOnPath && exitGates.includes(gateOnPath)) {
          balancedCounts[gateOnPath]++;
          // Accumulate routing load on the exit gate
          accumulatedRoutedLoad[gateOnPath] = (accumulatedRoutedLoad[gateOnPath] ?? 0) + 1;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Inequality Metrics Comparison
  // ---------------------------------------------------------------------------
  const naiveValues = exitGates.map((gate) => naiveCounts[gate]);
  const balancedValues = exitGates.map((gate) => balancedCounts[gate]);

  const naiveGini = calculateGini(naiveValues);
  const balancedGini = calculateGini(balancedValues);

  // Avoid division by zero if both lists are perfectly balanced (Gini = 0)
  let improvementRatio = 1;
  if (balancedGini === 0 && naiveGini > 0) {
    improvementRatio = naiveGini / 0.001; // Large ratio improvement
  } else if (balancedGini > 0) {
    improvementRatio = naiveGini / balancedGini;
  }

  return {
    gateDistribution: balancedCounts,
    giniCoefficient: balancedGini,
    comparedToNaive: {
      naiveGiniCoefficient: naiveGini,
      improvementRatio,
    },
  };
}
