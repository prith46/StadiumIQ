import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runIncentiveTriageService } from './incentiveService';
import { useSimStore } from '../store/simStore';
import { useIncentiveStore } from '../store/incentiveStore';
import { parseIncentivePayload } from '../onboarding/qr';
import { ZONES, POIS } from '../venue/venue';
import * as routingModule from './routing';

describe('Incentive Triage Service Integration', () => {
  const gates = ZONES.filter((z) => z.type === 'gate');
  const gateA = gates[0]?.id || 'gate-a';
  const gateB = gates[1]?.id || 'gate-b';
  // Fan's real current location — incentives must be personalized against this,
  // not fire blindly for every bottleneck stadium-wide (see M9-1/M9-2 fix).
  const fanZone = ZONES.find((z) => z.type === 'section')?.id || 'sec-101';

  beforeEach(() => {
    // Reset stores before each test
    useSimStore.setState({
      matchClockSec: 1000,
      density: {},
      gateStatus: { [gateA]: 'open', [gateB]: 'open' },
      routedLoad: {},
      incidents: [],
      sensorCounts: {},
      timeline: [],
      fanContext: {
        ...useSimStore.getState().fanContext,
        location: fanZone,
      },
    });
    useIncentiveStore.getState().reset();
  });

  it('does nothing when fanContext.location is unset — nothing to personalize against', () => {
    useSimStore.setState({
      density: { [gateA]: 0.9 },
      fanContext: {
        ...useSimStore.getState().fanContext,
        location: undefined,
      },
    });

    runIncentiveTriageService();

    expect(useIncentiveStore.getState().activeIncentives).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // 1. Target Concession/Merch POI Resolution
  // ---------------------------------------------------------------------------

  it('correctly maps the closest open food/merch POI and places it in activeIncentives', () => {
    // Make gateA congested
    useSimStore.setState({
      density: { [gateA]: 0.9 },
    });

    runIncentiveTriageService();

    const active = useIncentiveStore.getState().activeIncentives;
    expect(active.length).toBeGreaterThan(0);

    const incentive = active[0];
    expect(incentive).toBeDefined();
    // fromZone must be the fan's own real location (M9-1) — "View Clear Reroute"
    // computes its route from this field, so it must match where the fan is.
    expect(incentive.fromZone).toBe(fanZone);
    expect(incentive.reward).toContain('10% off concession');

    // Confirm POI type is food or merch
    const targetPoi = POIS.find((p) => p.nearestZone === incentive.toZone && (p.type === 'food' || p.type === 'merch'));
    expect(targetPoi).toBeDefined();
    expect(['food', 'merch']).toContain(targetPoi?.type);
  });

  // ---------------------------------------------------------------------------
  // 2. Safety Escape Guard ("Escape one bottleneck into another")
  // ---------------------------------------------------------------------------

  it('rejects candidate POI if path to it contains a second congested zone', () => {
    // Find all concourses and other zones, set them all to congested (except gateA)
    const concourseDensity: Record<string, number> = { [gateA]: 0.9 };
    for (const z of ZONES) {
      if (z.id !== gateA) {
        concourseDensity[z.id] = 0.8; // congested
      }
    }

    useSimStore.setState({
      density: concourseDensity,
    });

    runIncentiveTriageService();

    // Since the path to any food/merch POI passes through congested concourse zones,
    // the escape guard should reject all candidates and offer ZERO incentives.
    const active = useIncentiveStore.getState().activeIncentives;
    expect(active.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 3. Security QR Payload Validation
  // ---------------------------------------------------------------------------

  it('generates a valid, parseable QR payload structure', () => {
    useSimStore.setState({
      density: { [gateA]: 0.9 },
    });

    runIncentiveTriageService();

    const active = useIncentiveStore.getState().activeIncentives;
    expect(active.length).toBeGreaterThan(0);

    const payloadStr = active[0].qrPayload;
    
    // Parse using the new parseIncentivePayload helper
    const parsed = parseIncentivePayload(payloadStr);
    expect(parsed).not.toBeNull();
    expect(parsed?.fromZone).toBe(fanZone);
    expect(parsed?.toZone).toBe(active[0].toZone);
    expect(parsed?.reward).toBe(active[0].reward);
  });

  it('parseIncentivePayload rejects malformed, oversized, or invalid payloads', () => {
    // 1. Too large (> 500 bytes)
    const longString = 'A'.repeat(501);
    expect(parseIncentivePayload(longString)).toBeNull();

    // 2. Malformed JSON
    expect(parseIncentivePayload('{invalid json}')).toBeNull();

    // 3. Wrong schema type
    const wrongType = JSON.stringify({ v: 1, type: 'seat-block', zoneId: 'sec-101' });
    expect(parseIncentivePayload(wrongType)).toBeNull();

    // 4. Non-existent zones
    const badZones = JSON.stringify({
      v: 1,
      type: 'incentive',
      from: 'fake-zone-1',
      to: 'fake-zone-2',
      reward: '10% off',
    });
    expect(parseIncentivePayload(badZones)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // M9-1/M9-2 — Personalization and duplicate-stacking prevention
  // ---------------------------------------------------------------------------

  it('offers at most one incentive even when multiple unrelated gates are simultaneously congested', () => {
    // Congest every gate in the venue at once — previously this fired one
    // incentive PER bottleneck (stacking), regardless of the fan's location.
    const allGatesDensity: Record<string, number> = {};
    for (const g of ZONES.filter((z) => z.type === 'gate')) {
      allGatesDensity[g.id] = 0.9;
    }

    useSimStore.setState({ density: allGatesDensity });

    runIncentiveTriageService();

    const active = useIncentiveStore.getState().activeIncentives;
    expect(active.length).toBeLessThanOrEqual(1);
  });

  it('does not stack a duplicate offer when triage re-runs for the same bottleneck on the next tick', () => {
    useSimStore.setState({ density: { [gateA]: 0.9 } });

    runIncentiveTriageService();
    const firstCount = useIncentiveStore.getState().activeIncentives.length;
    expect(firstCount).toBeGreaterThan(0);

    // Advance the sim clock slightly (still well within the 300s cooldown /
    // same per-minute id bucket) and re-run triage as the hook would on the
    // next tick — must NOT add a second card for the same bottleneck.
    useSimStore.setState({ matchClockSec: 1010 });
    runIncentiveTriageService();

    expect(useIncentiveStore.getState().activeIncentives.length).toBe(firstCount);
  });

  // ---------------------------------------------------------------------------
  // 5. M10 — persistent sensory preferences reach the reroute computeRoute calls
  // ---------------------------------------------------------------------------

  it('merges fanContext.sensory into the filters passed to computeRoute when validating candidate POIs', () => {
    useSimStore.setState({
      density: { [gateA]: 0.9 },
      fanContext: {
        ...useSimStore.getState().fanContext,
        sensory: { quiet: true },
      },
    });

    const spy = vi.spyOn(routingModule, 'computeRoute');

    runIncentiveTriageService();

    expect(spy).toHaveBeenCalled();
    const sawQuietFilters = spy.mock.calls.some((call) => {
      const filters = call[7] as any;
      return filters?.avoidEnclosed === true && filters?.maxNoise === 'low';
    });
    expect(sawQuietFilters).toBe(true);

    spy.mockRestore();
  });

  it('still offers an incentive (soft filter never blocks) when a sensory preference is set', () => {
    useSimStore.setState({
      density: { [gateA]: 0.9 },
      fanContext: {
        ...useSimStore.getState().fanContext,
        sensory: { quiet: true },
      },
    });

    runIncentiveTriageService();

    const active = useIncentiveStore.getState().activeIncentives;
    expect(active.length).toBeGreaterThan(0);
  });
});
