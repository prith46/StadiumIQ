import { describe, it, expect } from 'vitest';
import { executeTool, TOOL_REGISTRY, UnknownToolError, detectStressHeuristic } from '../../lib/ai/tools';
import { Zone, SimState } from '../../lib/types';

describe('AI Tools Registry', () => {
  const dummyState: SimState = {
    matchClockSec: 0,
    density: {},
    gateStatus: {},
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
  };

  // 1. findAmenity returns top 3 open/busy POIs sorted by BFS distance
  it('findAmenity returns top open/busy POIs sorted by distance', async () => {
    // We execute the findAmenity tool
    const results: any = await executeTool('findAmenity', {
      fromZoneId: 'concourse-1-n',
      type: 'restroom',
      nearestOpen: true,
    }, ctx);

    expect(results).toBeInstanceOf(Array);
    expect(results.length).toBeLessThanOrEqual(3);

    // Verifiable top-3 order: same-zone restroom (hop 0) first, then the two
    // ring-adjacent tier-1 concourses (hop 1), tie broken alphabetically by id.
    expect(results.map((p: any) => p.id)).toEqual([
      'poi-restroom-1-n',
      'poi-restroom-1-e',
      'poi-restroom-1-w',
    ]);
  });

  // 2. detectStress identifies distress phrases, punctuation, and all-caps ratio
  it('detectStress heuristic checks text for panic keyword, exclamations, and caps ratio', () => {
    const calm = detectStressHeuristic('Hi, where is gate A?');
    expect(calm.stress).toBe(false);

    const keyword = detectStressHeuristic('help me I am lost');
    expect(keyword.stress).toBe(true);
    expect(keyword.matchedSignals).toContain('keyword:help');

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

  // 4. Stubs return their placeholder schemas
  it('stub tools return correct shape with __stub: true', async () => {
    const routeRes: any = await executeTool('computeRoute', { fromZoneId: 'sec-101', toZoneId: 'gate-a' }, ctx);
    expect(routeRes.__stub).toBe(true);
    expect(routeRes.path).toBeInstanceOf(Array);

    const forecastRes: any = await executeTool('getForecast', { zoneId: 'sec-101', timeSec: 100 }, ctx);
    expect(forecastRes.__stub).toBe(true);
    expect(forecastRes.predictedDensity).toBeTypeOf('object');

    const incentiveRes: any = await executeTool('getIncentive', { fromZoneId: 'sec-101' }, ctx);
    expect(incentiveRes.__stub).toBe(true);
    expect(incentiveRes.fromZone).toBe('sec-101');
  });

  // 5. Throws UnknownToolError for unmapped tool name
  it('executeTool throws UnknownToolError for unregistered tools', async () => {
    await expect(executeTool('nonExistentTool', {}, ctx)).rejects.toThrow(UnknownToolError);
  });
});
