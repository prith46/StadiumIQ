import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSimStore } from '../store/simStore';
import { decayRoutedLoad, tickSimulation, DEFAULT_SIM_CONFIG } from '../simulation/engine';
import { computeRoute } from './routing';
import { computeServiceRoute } from './routingService';
import * as routingModule from './routing';
import { EDGES, ZONES } from '../venue/venue';
import type { SimState } from '../types';

describe('Routing Service & Simulation Reset Integration', () => {
  // ---------------------------------------------------------------------------
  // 1. Decay Correctness
  // ---------------------------------------------------------------------------

  it('decays routedLoad values exponentially per tick by a factor of 0.9', () => {
    const initialLoad: Record<string, number> = { 'gate-a': 10, 'gate-b': 5 };

    // 1 tick decay
    const tick1 = decayRoutedLoad(initialLoad);
    expect(tick1['gate-a']).toBe(9.0);
    expect(tick1['gate-b']).toBe(4.5);

    // 2 ticks decay
    const tick2 = decayRoutedLoad(tick1);
    expect(tick2['gate-a']).toBeCloseTo(8.1, 5);

    // Multiple ticks decay to zero (< 0.01 limit)
    let load = initialLoad;
    for (let i = 0; i < 70; i++) {
      load = decayRoutedLoad(load);
    }
    // After 70 ticks (approx 52 minutes), it must have decayed to empty
    expect(Object.keys(load).length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 2. Phase Boundary Reset
  // ---------------------------------------------------------------------------

  it('resets routedLoad to empty across major match phase boundaries', () => {
    const dummyState: SimState = {
      matchClockSec: 2680, // In first half (ends at 2700)
      density: {},
      gateStatus: {},
      incidents: [],
      routedLoad: { 'gate-a': 5.0, 'gate-b': 3.0 },
      sensorCounts: {},
      timeline: [],
    };

    // tickSimulation advances clock by 45s to 2725 (Halftime phase)
    const next = tickSimulation(dummyState, ZONES, DEFAULT_SIM_CONFIG);
    expect(next.matchClockSec).toBe(2725);
    // Since it transitioned firstHalf -> half, routedLoad MUST be cleared
    expect(Object.keys(next.routedLoad).length).toBe(0);
  });

  it('does NOT reset routedLoad when ticking within the same phase', () => {
    const dummyState: SimState = {
      matchClockSec: 100, // In first half
      density: {},
      gateStatus: {},
      incidents: [],
      routedLoad: { 'gate-a': 10.0 },
      sensorCounts: {},
      timeline: [],
    };

    // tickSimulation advances to 145 (still first half)
    const next = tickSimulation(dummyState, ZONES, DEFAULT_SIM_CONFIG);
    expect(next.matchClockSec).toBe(145);
    // Decays but does NOT reset
    expect(next.routedLoad['gate-a']).toBe(9.0);
  });

  // ---------------------------------------------------------------------------
  // 3. Reason avoidedGates Under Herding Load
  // ---------------------------------------------------------------------------

  // MAP BUILD SPEC §22.7: each transit node now connects to exactly ONE nearest
  // gate (previously some transit nodes had 2 candidate gates). That removes the
  // multi-gate redundancy this test used to exercise "reroute to a different
  // gate" — with only one physical edge into a transit node, herding load on
  // its one gate can no longer be routed around (there is nowhere else to go),
  // so `reason.avoidedGates` for a transit/gate destination is structurally
  // empty in this topology. What congestion-awareness still correctly does:
  // heavily penalize (via congestionFactor) the edges terminating at the
  // congested gate, inflating ETA — proving load is read and applied, even
  // though this specific destination has no alternate gate to reroute onto.
  // (Gate-avoidance rerouting is still exercised by lib/engine/routing.test.ts's
  // hand-built fixture tests, which are independent of real venue topology.)
  it('inflates ETA under herding load on the (sole) gate serving a transit destination', () => {
    const density = {};
    const gateStatus = {
      'gate-a': 'open' as const,
      'gate-b': 'open' as const,
      'gate-c': 'open' as const,
      'gate-d': 'open' as const,
    };

    // 1. Uncongested run
    const routeClear = computeRoute(
      'sec-101',
      'transit-train',
      EDGES,
      ZONES,
      density,
      {}, // empty load
      gateStatus
    );
    expect('error' in routeClear).toBe(false);

    if (!('error' in routeClear)) {
      const clearGate = [...routeClear.path].reverse().find((id) => id.startsWith('gate-'));
      expect(clearGate).toBeDefined();

      if (clearGate) {
        // 2. Congested run (the sole gate serving transit-train has high herding load)
        const routedLoad = { [clearGate]: 30.0 };
        const routeCongested = computeRoute(
          'sec-101',
          'transit-train',
          EDGES,
          ZONES,
          density,
          routedLoad,
          gateStatus
        );
        expect('error' in routeCongested).toBe(false);

        if (!('error' in routeCongested)) {
          // Same gate is structurally required (no alternate edge into transit-train exists)...
          expect(routeCongested.path).toContain(clearGate);
          // ...but the herding load must still measurably inflate the route's ETA.
          expect(routeCongested.etaSec).toBeGreaterThan(routeClear.etaSec);
        }
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 4. M10 — persistent sensory preferences reach computeServiceRoute (the F4/M2
  //    chat, M9 incentive-accept, and M6 exit-alert path all call this function)
  // ---------------------------------------------------------------------------

  describe('computeServiceRoute — sensory preference integration', () => {
    beforeEach(() => {
      useSimStore.setState({
        density: {},
        routedLoad: {},
        gateStatus: {},
      });
    });

    it('merges fanContext.sensory into the filters passed to the underlying computeRoute engine', () => {
      useSimStore.setState({
        fanContext: {
          ...useSimStore.getState().fanContext,
          location: 'sec-101',
          sensory: { quiet: true },
        },
      });

      const spy = vi.spyOn(routingModule, 'computeRoute');

      computeServiceRoute({ kind: 'nearestExit' });

      expect(spy).toHaveBeenCalled();
      const filters = spy.mock.calls[0][7] as any;
      expect(filters?.avoidEnclosed).toBe(true);
      expect(filters?.maxNoise).toBe('low');

      spy.mockRestore();
    });

    // Real M3 scenario (no mocking of computeRoute): §22.7 marks a mid-tier
    // (tier 2) section's ONLY radial edges to its own concourse as
    // enclosed:true. Since that edge is mandatory (there is no other way off
    // a tier-2 section), requesting "quiet" MUST apply the 3x soft-filter
    // penalty to that edge and measurably change the computed route cost —
    // proving the preference isn't just stored, it actually alters routing.
    it('produces a measurably different (higher-cost, quieter) route with the quiet preference on than off, on the real venue graph', () => {
      const tier2Section = ZONES.find((z) => z.type === 'section' && z.tier === 2);
      expect(tier2Section).toBeDefined();
      const origin = tier2Section!.id;

      useSimStore.setState({
        fanContext: {
          ...useSimStore.getState().fanContext,
          location: origin,
          sensory: undefined,
        },
      });
      const routeDefault = computeServiceRoute({ kind: 'nearestExit' });
      expect('error' in routeDefault).toBe(false);

      useSimStore.setState({
        fanContext: {
          ...useSimStore.getState().fanContext,
          location: origin,
          sensory: { quiet: true },
        },
      });
      const routeQuiet = computeServiceRoute({ kind: 'nearestExit' });
      expect('error' in routeQuiet).toBe(false);

      if (!('error' in routeDefault) && !('error' in routeQuiet)) {
        // The mandatory enclosed first hop is now 3x-penalised, so the quiet
        // route's reported ETA must be strictly higher than the default route
        // — a real, measurable consequence of the preference, not a no-op.
        expect(routeQuiet.etaSec).toBeGreaterThan(routeDefault.etaSec);
      }
    });
  });
});
