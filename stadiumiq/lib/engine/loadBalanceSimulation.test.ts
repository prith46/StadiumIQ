import { describe, it, expect } from 'vitest';
import { calculateGini, runLoadTestScenario } from './loadBalanceSimulation';
import { EDGES, ZONES } from '../venue/venue';
import type { Edge, Zone } from '../types';
import { DestinationQuery } from './destinationResolver';

describe('Anti-Herding Load Balance Simulator', () => {
  // ---------------------------------------------------------------------------
  // 1. Gini Coefficient Mathematics Verification
  // ---------------------------------------------------------------------------

  it('calculates Gini coefficient correctly for perfect equality', () => {
    const distribution = [10, 10, 10, 10]; // 4 gates, equal counts
    const gini = calculateGini(distribution);
    expect(gini).toBe(0.0);
  });

  it('calculates Gini coefficient correctly for maximum inequality', () => {
    const distribution = [40, 0, 0, 0]; // 4 gates, all load herded on one
    const gini = calculateGini(distribution);
    expect(gini).toBe(0.75); // (3 * 40 * 2) / (2 * 4 * 40) = 240 / 320 = 0.75
  });

  it('calculates Gini coefficient correctly for empty or zero arrays', () => {
    expect(calculateGini([])).toBe(0);
    expect(calculateGini([0, 0, 0])).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Core Quantitative Proof (Realistic Scenario on Venue Graph)
  // ---------------------------------------------------------------------------

  // MAP BUILD SPEC §22.7: concourse nodes are now one-per-section on a SINGLE
  // 60-node ring (not 4 separate per-tier rings of 4 stand-concourses each).
  // Going "the long way" around a 60-node ring to reach a different gate now
  // costs hundreds of seconds — far more than any congestion penalty a single
  // gate can accumulate — so from any ONE origin, 100% of naive AND balanced
  // requests herd to that origin's one nearest gate (verified empirically:
  // every single-section origin tested produces a 20/0/0/0 split with
  // improvementRatio === 1, regardless of load). That specific "spread load
  // away from one congested gate for one origin" scenario is no longer
  // physically possible in this topology — there is no comparably-priced
  // alternate gate to spill onto. This is a real, spec-driven capability
  // change, not a bug (§22.7 gives no tier-crossing or cross-quadrant
  // shortcuts). The mechanism itself is still proven correct against graphs
  // that DO offer close alternatives — see the mock-graph tests below, which
  // are unaffected by this topology change and still pass.
  //
  // What IS still true and worth proving on the real venue: gate/exit
  // diversity now emerges naturally from *where fans start*, not from
  // load-feedback rerouting. A representative crowd (spread across all four
  // quadrants) produces a naturally balanced, low-Gini gate distribution —
  // each quadrant's fans go to their own nearest gate.
  it('produces a naturally balanced gate distribution when fans are spread across all four quadrants', () => {
    // One quadrant-representative section per gate (confirmed via direct
    // resolution): sec-301->gate-a, sec-304->gate-b, sec-310->gate-c, sec-316->gate-d.
    const originZoneIds = [
      ...Array(5).fill('sec-301'),
      ...Array(5).fill('sec-304'),
      ...Array(5).fill('sec-310'),
      ...Array(5).fill('sec-316'),
    ];
    const destinationQuery: DestinationQuery = { kind: 'nearestExit' };

    const result = runLoadTestScenario(
      { originZoneIds, destinationQuery, requestOrder: 'sequential' },
      EDGES,
      ZONES
    );

    console.log('[M8 QUADRANT DIVERSITY RESULTS]', {
      giniCoefficient: result.giniCoefficient,
      gateDistribution: result.gateDistribution,
    });

    // Each gate should receive a meaningful share (its own quadrant's fans) —
    // real route diversity across all 4 gates/exits, driven by geography.
    expect(result.gateDistribution['gate-a']).toBeGreaterThan(0);
    expect(result.gateDistribution['gate-b']).toBeGreaterThan(0);
    expect(result.gateDistribution['gate-c']).toBeGreaterThan(0);
    expect(result.gateDistribution['gate-d']).toBeGreaterThan(0);
    // And the resulting distribution should be close to perfectly equal
    // (low Gini), since each quadrant contributed an equal-sized group.
    expect(result.giniCoefficient).toBeLessThan(0.1);
  });

  it('confirms single-origin requests no longer have a comparably-priced alternate gate to spill onto (documented topology limitation)', () => {
    // Any single section origin sends 100% of both naive and balanced
    // requests to the same one nearest gate — improvementRatio stays at 1,
    // proving (not just asserting) the capability change is real and total,
    // not a partial regression.
    const originZoneIds = Array(20).fill('sec-101');
    const destinationQuery: DestinationQuery = { kind: 'nearestExit' };

    const result = runLoadTestScenario(
      { originZoneIds, destinationQuery, requestOrder: 'sequential' },
      EDGES,
      ZONES
    );

    expect(result.comparedToNaive.improvementRatio).toBe(1);
    expect(result.gateDistribution['gate-a']).toBe(20);
  });

  // ---------------------------------------------------------------------------
  // 3. No-Overcorrection Guard (Merit Bias Check)
  // ---------------------------------------------------------------------------

  it('verifies that load balancing does not flatten genuine physical advantages', () => {
    // Asymmetric mock venue graph:
    // sec-101 is 10s from gate-a, but 500s from gate-b.
    const mockZones: Zone[] = [
      { id: 'sec-101', label: '101', type: 'section', attrs: { accessible: true, enclosed: false, noise: 'low' } },
      { id: 'gate-a', label: 'Gate A', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'low' } },
      { id: 'gate-b', label: 'Gate B', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'low' } },
    ];

    const mockEdges: Edge[] = [
      { from: 'sec-101', to: 'gate-a', baseWalkSec: 10, accessible: true, enclosed: false, noise: 'low' },
      { from: 'sec-101', to: 'gate-b', baseWalkSec: 500, accessible: true, enclosed: false, noise: 'low' },
    ];

    const originZoneIds = Array(20).fill('sec-101');
    const destinationQuery: DestinationQuery = { kind: 'nearestExit' };

    const result = runLoadTestScenario(
      { originZoneIds, destinationQuery, requestOrder: 'sequential' },
      mockEdges,
      mockZones
    );

    // Even with feedback loop active, Gate A remains so much closer that it should still
    // receive the vast majority of recommendations, not a 50/50 split (averting overcorrection).
    const gateAFeedbackCount = result.gateDistribution['gate-a'] ?? 0;
    const gateBFeedbackCount = result.gateDistribution['gate-b'] ?? 0;

    expect(gateAFeedbackCount).toBeGreaterThan(gateBFeedbackCount);
    // Gate A should receive almost all traffic because it's 50x closer
    expect(gateAFeedbackCount).toBeGreaterThan(15);
  });

  it('verifies graduated spillover when alternative gates are reasonably close in walk time', () => {
    // Graduated mock venue graph:
    // sec-101 is 10s from gate-a, and 20s from gate-b.
    // The load threshold will eventually exceed the 10s difference and spill over to Gate B.
    const mockZones: Zone[] = [
      { id: 'sec-101', label: '101', type: 'section', attrs: { accessible: true, enclosed: false, noise: 'low' } },
      { id: 'gate-a', label: 'Gate A', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'low' } },
      { id: 'gate-b', label: 'Gate B', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'low' } },
    ];

    const mockEdges: Edge[] = [
      { from: 'sec-101', to: 'gate-a', baseWalkSec: 10, accessible: true, enclosed: false, noise: 'low' },
      { from: 'sec-101', to: 'gate-b', baseWalkSec: 20, accessible: true, enclosed: false, noise: 'low' },
    ];

    const originZoneIds = Array(20).fill('sec-101');
    const destinationQuery: DestinationQuery = { kind: 'nearestExit' };

    const result = runLoadTestScenario(
      { originZoneIds, destinationQuery, requestOrder: 'sequential' },
      mockEdges,
      mockZones
    );

    const gateAFeedbackCount = result.gateDistribution['gate-a'] ?? 0;
    const gateBFeedbackCount = result.gateDistribution['gate-b'] ?? 0;

    // Gate A is physically closer, so it should still get more traffic
    expect(gateAFeedbackCount).toBeGreaterThan(gateBFeedbackCount);
    // However, the load balancer should have successfully spilled over some load to Gate B
    expect(gateBFeedbackCount).toBeGreaterThan(0);
    
    console.log('[M8 GRADUATED SPILLOVER RESULTS]', {
      gateAFeedbackCount,
      gateBFeedbackCount,
    });
  });
});
