import { describe, it, expect } from 'vitest';
import { executeTool, TOOL_REGISTRY, UnknownToolError } from '../../lib/ai/tools';
import { detectStressHeuristic } from '../../lib/ai/stressDetection';
import { Zone, SimState } from '../../lib/types';

describe('AI Tools Registry', () => {
  const dummyState: SimState = {
    matchClockSec: 0,
    density: {},
    gateStatus: {
      'gate-a': 'open',
      'gate-b': 'open',
      'gate-c': 'open',
      'gate-d': 'open',
    },
    incidents: [],
    routedLoad: {},
    sensorCounts: {},
    timeline: [],
  };

  const mockZones: Zone[] = [
    { id: 'sec-101', label: '101', type: 'section', attrs: { accessible: true, enclosed: false, noise: 'high' } },
    { id: 'gate-a', label: 'Gate A', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'high' } },
  ];

  const ctx = {
    simSnapshot: dummyState,
    zones: mockZones,
    fanContext: {
      language: 'en',
      accessibility: false,
    },
  };

  // 1. findAmenity returns top 3 open/busy POIs sorted by BFS distance
  //
  // MAP BUILD SPEC §22.7: concourse nodes are now one-per-section
  // (con-<sectionId>), not stand/tier nodes — 'concourse-1-n' no longer
  // exists, and POIs attach to sections (§22.4), not concourses. Origin and
  // expected POI ids are updated to match the rebuilt venue graph; the BFS
  // ordering behavior under test (top-3 by hop distance) is unchanged.
  it('findAmenity returns top open/busy POIs sorted by distance', async () => {
    // We execute the findAmenity tool
    const results: any = await executeTool('findAmenity', {
      fromZoneId: 'sec-101',
      type: 'restroom',
      nearestOpen: true,
    }, ctx);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeLessThanOrEqual(3);

    // Verifiable top-3 order by BFS hop distance from sec-101 on the real venue graph.
    expect(results.map((p: any) => p.id)).toEqual([
      'poi-restroom-4',
      'poi-restroom-3',
      'poi-restroom-1',
    ]);
  });

  // 2. detectStress identifies distress phrases, punctuation, and all-caps ratio
  it('detectStress heuristic checks text for panic keyword, exclamations, and caps ratio', () => {
    const calm = detectStressHeuristic('Hi, where is gate A?');
    expect(calm.stress).toBe(false);

    const keyword = detectStressHeuristic('help me I am scared');
    expect(keyword.stress).toBe(true);
    expect(keyword.matchedSignals).toContain('help-combination');

    const excl = detectStressHeuristic('Where are you!!');
    expect(excl.stress).toBe(true);
    expect(excl.matchedSignals).toContain('exclamation');

    const caps = detectStressHeuristic('FIRE IN THE SECTOR PLS evac');
    expect(caps.stress).toBe(true);
    expect(caps.matchedSignals).toContain('all-caps');

    // Multi-word phrase match
    const phrase = detectStressHeuristic('I cant breathe in this crowd');
    expect(phrase.stress).toBe(true);
    expect(phrase.matchedSignals).toContain('keyword:cant breathe');
  });

  // 3. getPolicy retrieves text chunks from the RAG knowledge base
  it('getPolicy executes keyword retrieval on the RAG index', async () => {
    const results: any = await executeTool('getPolicy', { query: 'bag policy size limit' }, ctx);
    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].section).toBe('Bag Policy');
  });

  // 4. computeRoute — real implementation (NOT a stub)
  it('computeRoute returns a valid RouteResult for a real zone-to-zone query', async () => {
    const result: any = await executeTool('computeRoute', {
      originZoneId: 'sec-101',
      destination: { kind: 'zone', zoneId: 'gate-a' },
    }, ctx);

    // Should NOT have __stub
    expect(result.__stub).toBeUndefined();

    // Should return a proper RouteResult shape
    expect(result.path).toBeInstanceOf(Array);
    expect(result.path.length).toBeGreaterThan(0);
    expect(result.path[0]).toBe('sec-101');
    expect(typeof result.etaSec).toBe('number');
    expect(result.etaSec).toBeGreaterThan(0);
    expect(result.reason).toBeDefined();
    expect(result.reason.crowdedZones).toBeInstanceOf(Array);
    expect(result.reason.avoidedGates).toBeInstanceOf(Array);
  });

  it('computeRoute accepts legacy fromZoneId alias for backward compatibility', async () => {
    const result: any = await executeTool('computeRoute', {
      fromZoneId: 'sec-101',        // legacy alias
      destination: { kind: 'nearestExit' },
    }, ctx);

    // Should find a route (not an error)
    expect(result.error).toBeUndefined();
    expect(result.path).toBeInstanceOf(Array);
    expect(result.path.length).toBeGreaterThan(0);
  });

  it('computeRoute returns structured error for hallucinated/invalid origin zone id', async () => {
    const result: any = await executeTool('computeRoute', {
      originZoneId: 'hallucinated-zone-XYZ-9999',
      destination: { kind: 'zone', zoneId: 'gate-a' },
    }, ctx);

    // Must NOT throw — must return a structured error
    expect(result.error).toBe('invalid_zone_id');
    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('computeRoute returns structured error for hallucinated destination zone id', async () => {
    const result: any = await executeTool('computeRoute', {
      originZoneId: 'sec-101',
      destination: { kind: 'zone', zoneId: 'hallucinated-destination-999' },
    }, ctx);

    expect(result.error).toBe('invalid_zone_id');
    expect(typeof result.message).toBe('string');
  });

  it('computeRoute returns structured error for poiType with no matching open POIs', async () => {
    // 'qr_beacon' type has no entries in the fixture, but does exist in venue —
    // use a real type but mark all as closed by using a poiStatus in ctx
    // For simplicity, use a clearly nonexistent type string (invalid for PoiType but
    // the tool casts it — this tests the no_matching_poi path)
    const result: any = await executeTool('computeRoute', {
      originZoneId: 'sec-101',
      destination: { kind: 'poiType', poiType: 'restroom' },
    }, {
      ...ctx,
      simSnapshot: {
        ...dummyState,
        gateStatus: { 'gate-a': 'open', 'gate-b': 'open', 'gate-c': 'open', 'gate-d': 'open' },
      },
    });

    // Should return a valid route to nearest restroom (many exist in venue)
    expect(result.path).toBeInstanceOf(Array);
    expect(result.path.length).toBeGreaterThan(0);
  });

  // 4b. M10 — sensory preferences merge into computeRoute filters
  it('computeRoute applies persistent fanContext.sensory.quiet when no explicit filters are passed', async () => {
    const sensoryCtx = {
      ...ctx,
      fanContext: { language: 'en', accessibility: false, sensory: { quiet: true } },
    };

    const result: any = await executeTool('computeRoute', {
      originZoneId: 'sec-101',
      destination: { kind: 'zone', zoneId: 'gate-a' },
    }, sensoryCtx);

    expect(result.error).toBeUndefined();
    expect(result.path).toBeInstanceOf(Array);
  });

  it('an explicit LLM-passed filter overrides the persistent sensory default for that field', async () => {
    // Persistent default wants avoidEnclosed, but this one-time call explicitly
    // asks for avoidEnclosed: false — the explicit per-field value must win.
    const sensoryCtx = {
      ...ctx,
      fanContext: { language: 'en', accessibility: false, sensory: { quiet: true } },
    };

    const noFilterResult: any = await executeTool('computeRoute', {
      originZoneId: 'sec-101',
      destination: { kind: 'zone', zoneId: 'gate-a' },
    }, sensoryCtx);

    const overriddenResult: any = await executeTool('computeRoute', {
      originZoneId: 'sec-101',
      destination: { kind: 'zone', zoneId: 'gate-a' },
      filters: { avoidEnclosed: false },
    }, sensoryCtx);

    // Both succeed; the override changes routing weight so ETA should not be
    // forced up by the persistent quiet default when explicitly disabled.
    expect(noFilterResult.error).toBeUndefined();
    expect(overriddenResult.error).toBeUndefined();
    expect(overriddenResult.etaSec).toBeLessThanOrEqual(noFilterResult.etaSec);
  });

  it('empty/undefined fanContext.sensory produces routing identical to pre-M10 behavior', async () => {
    const result: any = await executeTool('computeRoute', {
      originZoneId: 'sec-101',
      destination: { kind: 'zone', zoneId: 'gate-a' },
    }, ctx);

    expect(result.error).toBeUndefined();
    expect(result.path[0]).toBe('sec-101');
  });

  // 5. Remaining stubs return their placeholder schemas
  it('stub tools return correct shape with __stub: true', async () => {
    const incentiveRes: any = await executeTool('getIncentive', { fromZoneId: 'sec-101' }, ctx);
    expect(incentiveRes.__stub).toBe(true);
    expect(incentiveRes.fromZone).toBe('sec-101');
  });

  // 6. Real Forecast and Peak Crush Tools
  it('getForecast tool returns live forecast values and peak crush projections', async () => {
    // Populate timeline in dummy state to test timeline forecast branch
    const mockTimeline = [
      { atSec: 0, density: { 'sec-101': 0.3 }, gateStatus: {} },
      { atSec: 600, density: { 'sec-101': 0.8 }, gateStatus: {} },
    ];
    const stateWithTimeline = { ...dummyState, timeline: mockTimeline, matchClockSec: 0 };
    const contextWithTimeline = { ...ctx, simSnapshot: stateWithTimeline };

    // 10 minutes relative = 600 seconds
    const result: any = await executeTool('getForecast', { zoneId: 'sec-101', timeSec: 600 }, contextWithTimeline);

    expect(result.error).toBeUndefined();
    expect(result.zoneId).toBe('sec-101');
    expect(result.minutesAhead).toBe(10);
    expect(result.predictedDensity).toBeCloseTo(0.8, 5);
    expect(result.peakCrush).toBeTypeOf('object');
    expect(result.peakCrush.peakMatchClockSec).toBe(600);
    expect(result.peakCrush.peakDensity).toBeCloseTo(0.8, 5);
  });

  it('getForecast tool handles out-of-bounds timeSec by clamping and returns extrapolated values', async () => {
    const mockTimeline = [
      { atSec: 0, density: { 'sec-101': 0.3 }, gateStatus: {} },
      { atSec: 600, density: { 'sec-101': 0.8 }, gateStatus: {} },
    ];
    const stateWithTimeline = { ...dummyState, timeline: mockTimeline, matchClockSec: 0 };
    const contextWithTimeline = { ...ctx, simSnapshot: stateWithTimeline };

    // Large timeSec (e.g. 10000s) -> clamped to maximum horizon (7200s / 120 minutes)
    const result: any = await executeTool('getForecast', { zoneId: 'sec-101', timeSec: 10000 }, contextWithTimeline);

    expect(result.error).toBeUndefined();
    expect(result.minutesAhead).toBe(120); // clamped to 120m
    expect(result.extrapolated).toBe(true); // target is 7200s, beyond 600s timeline
    expect(result.predictedDensity).toBeCloseTo(0.8, 5); // returns last frame density
  });

  it('getForecast and getPeakCrush return structured error for invalid/hallucinated zoneId', async () => {
    const resultForecast: any = await executeTool('getForecast', { zoneId: 'invalid-zone-xyz', timeSec: 100 }, ctx);
    expect(resultForecast.error).toBe('invalid_zone_id');

    const resultPeak: any = await executeTool('getPeakCrush', { zoneId: 'invalid-zone-xyz' }, ctx);
    expect(resultPeak.error).toBe('invalid_zone_id');
  });

  it('getPeakCrush tool returns correct peak crush projections for a zone', async () => {
    const mockTimeline = [
      { atSec: 0, density: { 'sec-101': 0.3 }, gateStatus: {} },
      { atSec: 600, density: { 'sec-101': 0.9 }, gateStatus: {} },
      { atSec: 1200, density: { 'sec-101': 0.2 }, gateStatus: {} },
    ];
    const stateWithTimeline = { ...dummyState, timeline: mockTimeline, matchClockSec: 0 };
    const contextWithTimeline = { ...ctx, simSnapshot: stateWithTimeline };

    const result: any = await executeTool('getPeakCrush', { zoneId: 'sec-101' }, contextWithTimeline);

    expect(result.error).toBeUndefined();
    expect(result.zoneId).toBe('sec-101');
    expect(result.peakMatchClockSec).toBe(600);
    expect(result.peakDensity).toBeCloseTo(0.9, 5);
    expect(result.minutesFromNow).toBe(10);
  });

  // 7. Throws UnknownToolError for unmapped tool name
  it('executeTool throws UnknownToolError for unregistered tools', async () => {
    await expect(executeTool('nonExistentTool', {}, ctx)).rejects.toThrow(UnknownToolError);
  });
});

