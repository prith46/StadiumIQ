import { describe, it, expect } from 'vitest';
import { Zone } from '../../lib/types';
import { generateTimeline, nearestFrame } from '../../lib/simulation/timeline';

describe('Simulation Timeline Helpers', () => {
  const mockZones: Zone[] = [
    { id: 'sec-101', label: '101', type: 'section', attrs: { accessible: true, enclosed: false, noise: 'high' } },
    { id: 'gate-a', label: 'Gate A', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'high' } }
  ];

  // Test determinism
  it('generateTimeline is deterministic', () => {
    const seed = 20260710;
    const timeline1 = generateTimeline(mockZones, seed);
    const timeline2 = generateTimeline(mockZones, seed);
    expect(timeline1).toEqual(timeline2);
  });

  // Test seed variability
  it('generateTimeline produces different density values for different seeds', () => {
    const seed1 = 20260710;
    const seed2 = 99999999;
    const timeline1 = generateTimeline(mockZones, seed1);
    const timeline2 = generateTimeline(mockZones, seed2);

    // Assert that at least one frame has different densities due to different seeds
    let foundDifference = false;
    for (let i = 0; i < timeline1.length; i++) {
      if (timeline1[i].density['sec-101'] !== timeline2[i].density['sec-101']) {
        foundDifference = true;
        break;
      }
    }
    expect(foundDifference).toBe(true);
  });

  // Test density boundaries
  it('Every frame density is within [0, 1]', () => {
    const timeline = generateTimeline(mockZones, 20260710);
    for (const frame of timeline) {
      for (const val of Object.values(frame.density)) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThanOrEqual(1);
      }
    }
  });

  // Test nearestFrame lookup
  it('nearestFrame returns closest frame for target seconds', () => {
    const seed = 20260710;
    const timeline = generateTimeline(mockZones, seed);

    // Frame at index 0 represents MATCH_START_SEC (-1800)
    // Frame at index 1 represents -1740 (if step is 60)
    expect(timeline[0].atSec).toBe(-1800);
    expect(timeline[1].atSec).toBe(-1740);

    // Closest to -1800
    expect(nearestFrame(timeline, -1800)).toBe(timeline[0]);
    expect(nearestFrame(timeline, -1799)).toBe(timeline[0]);
    expect(nearestFrame(timeline, -1771)).toBe(timeline[0]); // -1771 is closer to -1800 (diff 29) than -1740 (diff 31)

    // Closest to -1740
    expect(nearestFrame(timeline, -1769)).toBe(timeline[1]); // -1769 is closer to -1740 (diff 29) than -1800 (diff 31)
    expect(nearestFrame(timeline, -1740)).toBe(timeline[1]);

    // Tie-breaker: ties -> earlier frame
    // Midpoint between -1800 and -1740 is -1770
    expect(nearestFrame(timeline, -1770)).toBe(timeline[0]);
  });
});
