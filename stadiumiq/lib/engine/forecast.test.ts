import { describe, it, expect } from 'vitest';
import { forecastAt, findPeakCrush, DensityFrame } from './forecast';

describe('Predictive Crowd Forecasting (M7)', () => {
  // Simple hand-authored fixture timeline
  const fixtureTimeline: DensityFrame[] = [
    {
      atSec: 100,
      density: {
        'zone-a': 0.2,
        'zone-b': 0.4,
        'zone-c': 0.1,
      },
    },
    {
      atSec: 200,
      density: {
        'zone-a': 0.8,
        'zone-b': 0.6,
        'zone-c': 0.1,
      },
    },
    {
      atSec: 300,
      density: {
        'zone-a': 0.5,
        'zone-b': 0.5,
        'zone-c': 0.5,
      },
    },
  ];

  // ---------------------------------------------------------------------------
  // 1. forecastAt Tests
  // ---------------------------------------------------------------------------
  describe('forecastAt', () => {
    it('exact frame match (no interpolation needed) returns exact density', () => {
      const result = forecastAt(fixtureTimeline, 100, 100); // targetSec = 200
      expect(result.requestedAtSec).toBe(100);
      expect(result.targetSec).toBe(200);
      expect(result.extrapolated).toBe(false);
      expect(result.density).toEqual({
        'zone-a': 0.8,
        'zone-b': 0.6,
        'zone-c': 0.1,
      });
    });

    it('mid-point between two frames interpolates correctly (lerp math verification)', () => {
      const result = forecastAt(fixtureTimeline, 100, 50); // targetSec = 150 (midway 100 & 200)
      expect(result.requestedAtSec).toBe(100);
      expect(result.targetSec).toBe(150);
      expect(result.extrapolated).toBe(false);
      
      // lerp(0.2, 0.8, 0.5) = 0.5
      // lerp(0.4, 0.6, 0.5) = 0.5
      // lerp(0.1, 0.1, 0.5) = 0.1
      expect(result.density!['zone-a']).toBeCloseTo(0.5, 5);
      expect(result.density!['zone-b']).toBeCloseTo(0.5, 5);
      expect(result.density!['zone-c']).toBeCloseTo(0.1, 5);
    });

    it('non-midpoint interpolation math check', () => {
      const result = forecastAt(fixtureTimeline, 100, 25); // targetSec = 125 (t = 0.25)
      expect(result.requestedAtSec).toBe(100);
      expect(result.targetSec).toBe(125);
      expect(result.extrapolated).toBe(false);
      
      // lerp(0.2, 0.8, 0.25) = 0.2 + 0.6 * 0.25 = 0.35
      // lerp(0.4, 0.6, 0.25) = 0.4 + 0.2 * 0.25 = 0.45
      // lerp(0.1, 0.1, 0.25) = 0.1
      expect(result.density!['zone-a']).toBeCloseTo(0.35, 5);
      expect(result.density!['zone-b']).toBeCloseTo(0.45, 5);
      expect(result.density!['zone-c']).toBeCloseTo(0.1, 5);
    });

    it('aheadSec beyond timeline horizon returns last frame with extrapolated: true', () => {
      const result = forecastAt(fixtureTimeline, 200, 200); // targetSec = 400 (beyond 300)
      expect(result.requestedAtSec).toBe(200);
      expect(result.targetSec).toBe(400);
      expect(result.extrapolated).toBe(true);
      expect(result.density).toEqual(fixtureTimeline[2].density);
    });

    it('negative/zero aheadSec clamps to first frame with extrapolated: true if before timeline[0].atSec', () => {
      const result = forecastAt(fixtureTimeline, 50, 0); // targetSec = 50 (before 100)
      expect(result.requestedAtSec).toBe(50);
      expect(result.targetSec).toBe(50);
      expect(result.extrapolated).toBe(true);
      expect(result.density).toEqual(fixtureTimeline[0].density);
    });

    it('negative aheadSec resulting in past target clamps to first frame with extrapolated: true', () => {
      const result = forecastAt(fixtureTimeline, 150, -100); // targetSec = 50 (before 100)
      expect(result.requestedAtSec).toBe(150);
      expect(result.targetSec).toBe(50);
      expect(result.extrapolated).toBe(true);
      expect(result.density).toEqual(fixtureTimeline[0].density);
    });

    it('empty timeline handles safely and returns extrapolated: true', () => {
      const result = forecastAt([], 100, 50);
      expect(result.requestedAtSec).toBe(100);
      expect(result.targetSec).toBe(150);
      expect(result.extrapolated).toBe(true);
      expect(result.density).toEqual({});
    });

    it('single-frame timeline returns that frame unmodified with extrapolated: true', () => {
      const singleTimeline = [fixtureTimeline[0]];
      const result = forecastAt(singleTimeline, 100, 50); // targetSec = 150
      expect(result.requestedAtSec).toBe(100);
      expect(result.targetSec).toBe(150);
      expect(result.extrapolated).toBe(true);
      expect(result.density).toEqual(fixtureTimeline[0].density);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. findPeakCrush Tests
  // ---------------------------------------------------------------------------
  describe('findPeakCrush', () => {
    const peakTimeline: DensityFrame[] = [
      {
        atSec: 1000,
        density: { 'zone-1': 0.1, 'zone-2': 0.2 }, // sum = 0.3
      },
      {
        atSec: 2000,
        density: { 'zone-1': 0.9, 'zone-2': 0.8, 'zone-3': 0.7 }, // sum = 2.4
      },
      {
        atSec: 3000,
        density: { 'zone-1': 0.3, 'zone-2': 0.4 }, // sum = 0.7
      },
    ];

    it('returns peak frame and correct topZones order on a known single peak frame', () => {
      const result = findPeakCrush(peakTimeline, 1000, 2500); // search window [1000, 3500]
      expect(result.peakAtSec).toBe(2000);
      expect(result.peakScore).toBeCloseTo(2.4, 5);
      expect(result.topZones).toEqual([
        { zoneId: 'zone-1', density: 0.9 },
        { zoneId: 'zone-2', density: 0.8 },
        { zoneId: 'zone-3', density: 0.7 },
      ]);
    });

    it('horizon boundary - peak just outside horizonSec is excluded, peak just inside is included', () => {
      // 1. Peak at 2000 is just inside if horizon reaches 2000 (horizonSec = 1000 starting from 1000)
      const insideResult = findPeakCrush(peakTimeline, 1000, 1000); // window [1000, 2000]
      expect(insideResult.peakAtSec).toBe(2000);

      // 2. Peak at 2000 is just outside if horizon reaches 1999 (horizonSec = 999 starting from 1000)
      const outsideResult = findPeakCrush(peakTimeline, 1000, 999); // window [1000, 1999]
      expect(outsideResult.peakAtSec).toBe(1000); // Falls back to only matching candidate
    });

    it('empty timeline returns default/safe structure', () => {
      const result = findPeakCrush([], 1500, 1000);
      expect(result.peakAtSec).toBe(1500);
      expect(result.peakScore).toBe(0);
      expect(result.topZones).toEqual([]);
    });

    it('single-frame timeline returns that frame as peak', () => {
      const singleTimeline = [peakTimeline[0]];
      const result = findPeakCrush(singleTimeline, 1500, 1000);
      expect(result.peakAtSec).toBe(1000);
      expect(result.peakScore).toBeCloseTo(0.3, 5);
      expect(result.topZones).toEqual([
        { zoneId: 'zone-2', density: 0.2 },
        { zoneId: 'zone-1', density: 0.1 },
      ]);
    });

    it('tie-breaking on equal density values breaks ties by zoneId ascending and takes top 5', () => {
      const tieTimeline: DensityFrame[] = [
        {
          atSec: 100,
          density: {
            'zone-f': 0.5,
            'zone-d': 0.5,
            'zone-b': 0.5,
            'zone-a': 0.5,
            'zone-e': 0.5,
            'zone-c': 0.5,
          },
        },
      ];

      const result = findPeakCrush(tieTimeline, 100, 1000);
      expect(result.peakAtSec).toBe(100);
      expect(result.peakScore).toBeCloseTo(3.0, 5);
      expect(result.topZones).toEqual([
        { zoneId: 'zone-a', density: 0.5 },
        { zoneId: 'zone-b', density: 0.5 },
        { zoneId: 'zone-c', density: 0.5 },
        { zoneId: 'zone-d', density: 0.5 },
        { zoneId: 'zone-e', density: 0.5 },
      ]);
    });

    it('earliest frame returned in case of peak score tie', () => {
      const tieScoreTimeline: DensityFrame[] = [
        {
          atSec: 100,
          density: { 'zone-a': 0.5, 'zone-b': 0.5 }, // sum = 1.0
        },
        {
          atSec: 200,
          density: { 'zone-a': 0.4, 'zone-b': 0.6 }, // sum = 1.0
        },
      ];
      const result = findPeakCrush(tieScoreTimeline, 100, 200);
      expect(result.peakAtSec).toBe(100); // Pick earliest matching maximum score
    });
  });
});
