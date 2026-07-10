import { describe, it, expect } from 'vitest';
import { Zone, SimState } from '../../lib/types';
import {
  matchPhase,
  computeBaseDensity,
  tickSimulation,
  decayRoutedLoad,
  mergeStatePatch,
  pruneAndCountSessions,
  FULL_TIME_END_SEC,
  SESSION_TTL_MS,
  DEFAULT_SIM_CONFIG,
} from '../../lib/simulation/engine';

describe('Simulation Engine - Pure Functions', () => {
  // Test matchPhase boundaries
  it('matchPhase returns correct phase at boundary seconds', () => {
    expect(matchPhase(-1)).toBe('pre');
    expect(matchPhase(0)).toBe('firstHalf');
    expect(matchPhase(2699)).toBe('firstHalf');
    expect(matchPhase(2700)).toBe('half');
    expect(matchPhase(3599)).toBe('half');
    expect(matchPhase(3600)).toBe('secondHalf');
    expect(matchPhase(6299)).toBe('secondHalf');
    expect(matchPhase(6300)).toBe('fullTime');
    expect(matchPhase(8100)).toBe('fullTime');
  });

  // Test computeBaseDensity range
  it('computeBaseDensity output always within [0, 1] across a swept range of seconds', () => {
    const sectionZone: Zone = {
      id: 'sec-101',
      label: '101',
      type: 'section',
      attrs: { accessible: true, enclosed: false, noise: 'high' }
    };
    const gateZone: Zone = {
      id: 'gate-a',
      label: 'Gate A',
      type: 'gate',
      attrs: { accessible: true, enclosed: false, noise: 'high' }
    };

    // Sweep seconds from pre-match to post-match
    for (let sec = -1800; sec <= 8100; sec += 100) {
      const secDensity = computeBaseDensity(sectionZone, sec);
      const gateDensity = computeBaseDensity(gateZone, sec);
      expect(secDensity).toBeGreaterThanOrEqual(0);
      expect(secDensity).toBeLessThanOrEqual(1);
      expect(gateDensity).toBeGreaterThanOrEqual(0);
      expect(gateDensity).toBeLessThanOrEqual(1);
    }
  });

  // Test tickSimulation purity
  it('tickSimulation is pure, returns deep-equal outputs on repeated calls, and does not mutate inputs', () => {
    const zones: Zone[] = [
      { id: 'sec-101', label: '101', type: 'section', attrs: { accessible: true, enclosed: false, noise: 'high' } },
      { id: 'gate-a', label: 'Gate A', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'high' } }
    ];

    const state: SimState = {
      matchClockSec: 0,
      density: { 'sec-101': 0.6, 'gate-a': 0.5 },
      gateStatus: { 'gate-a': 'open' },
      incidents: [],
      routedLoad: { 'sec-101': 0.5 },
      sensorCounts: { 'sec-101': 0 },
      timeline: []
    };

    const config = {
      tickIntervalMs: 2000,
      simSecondsPerTick: 45,
      seed: 20260710
    };

    // Capture density reference before
    const densityRefBefore = state.density;

    // Call once
    const res1 = tickSimulation(state, zones, config);
    // Call twice
    const res2 = tickSimulation(state, zones, config);

    // Deep equal outputs
    expect(res1).toEqual(res2);

    // No input mutation check
    expect(state.density).toBe(densityRefBefore);
    expect(state.density['sec-101']).toBe(0.6);
    expect(state.matchClockSec).toBe(0);
  });

  // Test decayRoutedLoad
  it('decayRoutedLoad reduces values by exactly the decay factor and drops near-zero keys', () => {
    const routedLoad = {
      'sec-101': 0.5,
      'sec-102': 0.009, // Should be dropped immediately since it is < 0.01 *after* decay?
      // Wait, 0.009 * 0.9 = 0.0081, which is < 0.01. It will be dropped.
      // What about a value that is exactly 0.01? 0.01 * 0.9 = 0.009, which is < 0.01. So it is dropped.
      // What about a value that is 0.0111? 0.0111 * 0.9 = 0.00999, which is < 0.01. It is dropped.
      // What about 0.02? 0.02 * 0.9 = 0.018, which is >= 0.01. It is kept.
      'sec-103': 0.0105 // 0.0105 * 0.9 = 0.00945, which is < 0.01. Should be dropped.
    };

    const decayed = decayRoutedLoad(routedLoad);
    expect(decayed['sec-101']).toBeCloseTo(0.45);
    expect(decayed['sec-102']).toBeUndefined();
    expect(decayed['sec-103']).toBeUndefined();
  });

  // Test mergeStatePatch
  it('mergeStatePatch shallow-merges density and wholly replaces incidents', () => {
    const state: SimState = {
      matchClockSec: 100,
      density: { 'sec-101': 0.4, 'sec-102': 0.6 },
      gateStatus: { 'gate-a': 'open' },
      incidents: [{ id: 'inc-1', type: 'crowd', zoneId: 'sec-101', note: 'Crowd build-up', status: 'pending', createdAt: 12345 }],
      routedLoad: {},
      sensorCounts: {},
      timeline: []
    };

    const patch: Partial<SimState> = {
      density: { 'sec-102': 0.9, 'sec-103': 0.2 },
      incidents: [{ id: 'inc-2', type: 'medical', zoneId: 'sec-102', note: 'Injury', status: 'dispatched', createdAt: 12346 }]
    };

    const merged = mergeStatePatch(state, patch);

    // Shallow merge of density
    expect(merged.density['sec-101']).toBe(0.4); // Survives
    expect(merged.density['sec-102']).toBe(0.9); // Overwritten
    expect(merged.density['sec-103']).toBe(0.2); // Added

    // Wholly replaces incidents
    expect(merged.incidents.length).toBe(1);
    expect(merged.incidents[0].id).toBe('inc-2');
  });

  // mergeStatePatch full semantics: gateStatus/sensorCounts/routedLoad shallow-merge,
  // timeline wholly replaced, matchClockSec overwritten only when present.
  it('mergeStatePatch shallow-merges record fields and wholly replaces timeline', () => {
    const state: SimState = {
      matchClockSec: 100,
      density: { 'sec-101': 0.4 },
      gateStatus: { 'gate-a': 'open', 'gate-b': 'closed' },
      incidents: [],
      routedLoad: { 'sec-101': 0.5, 'sec-102': 0.2 },
      sensorCounts: { 'sec-101': 3 },
      timeline: [{ atSec: -1800, density: { 'sec-101': 0.1 }, gateStatus: {} }],
    };

    const patch: Partial<SimState> = {
      gateStatus: { 'gate-a': 'congested' },        // gate-b must survive
      routedLoad: { 'sec-102': 0.9 },               // sec-101 must survive
      sensorCounts: { 'sec-103': 7 },               // sec-101 must survive
      timeline: [{ atSec: 0, density: { 'sec-101': 0.9 }, gateStatus: {} }],
    };

    const merged = mergeStatePatch(state, patch);

    // gateStatus shallow-merged
    expect(merged.gateStatus['gate-a']).toBe('congested'); // overwritten
    expect(merged.gateStatus['gate-b']).toBe('closed');    // survives
    // routedLoad shallow-merged
    expect(merged.routedLoad['sec-101']).toBe(0.5);        // survives
    expect(merged.routedLoad['sec-102']).toBe(0.9);        // overwritten
    // sensorCounts shallow-merged
    expect(merged.sensorCounts['sec-101']).toBe(3);        // survives
    expect(merged.sensorCounts['sec-103']).toBe(7);        // added
    // timeline wholly replaced
    expect(merged.timeline.length).toBe(1);
    expect(merged.timeline[0].atSec).toBe(0);
    // matchClockSec unchanged (not in patch)
    expect(merged.matchClockSec).toBe(100);
    // inputs not mutated
    expect(state.gateStatus['gate-a']).toBe('open');
    expect(state.timeline[0].atSec).toBe(-1800);
  });

  // matchClockSec is clamped at FULL_TIME_END_SEC and never exceeds it after repeated ticks.
  it('tickSimulation clamps matchClockSec at FULL_TIME_END_SEC', () => {
    const zones: Zone[] = [
      { id: 'sec-101', label: '101', type: 'section', attrs: { accessible: true, enclosed: false, noise: 'high' } },
    ];
    let state: SimState = {
      matchClockSec: FULL_TIME_END_SEC - 10,
      density: {}, gateStatus: {}, incidents: [], routedLoad: {}, sensorCounts: {}, timeline: [],
    };
    for (let i = 0; i < 20; i++) {
      state = tickSimulation(state, zones, DEFAULT_SIM_CONFIG);
      expect(state.matchClockSec).toBeLessThanOrEqual(FULL_TIME_END_SEC);
    }
    expect(state.matchClockSec).toBe(FULL_TIME_END_SEC);
  });

  // pruneAndCountSessions drops entries older than SESSION_TTL_MS using an INJECTED nowMs
  // (no wall-clock / real timers => not flaky).
  it('pruneAndCountSessions prunes stale sessions by injected nowMs and is pure', () => {
    const nowMs = 1_000_000;
    const heartbeats = {
      'sec-101': {
        fresh: nowMs - 1000,                 // within TTL -> kept
        edge: nowMs - SESSION_TTL_MS,        // exactly at TTL boundary (<=) -> kept
        stale: nowMs - SESSION_TTL_MS - 1,   // just past TTL -> dropped
      },
      'sec-102': {
        old: nowMs - 999_999,                // dropped -> whole zone drops (count 0)
      },
    };
    const snapshot = JSON.stringify(heartbeats);

    const { pruned, counts } = pruneAndCountSessions(heartbeats, nowMs);

    expect(counts['sec-101']).toBe(2);
    expect(pruned['sec-101']).toEqual({ fresh: nowMs - 1000, edge: nowMs - SESSION_TTL_MS });
    expect(counts['sec-102']).toBeUndefined();
    expect(pruned['sec-102']).toBeUndefined();
    // input untouched (purity)
    expect(JSON.stringify(heartbeats)).toBe(snapshot);
  });
});
