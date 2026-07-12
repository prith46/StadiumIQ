import { describe, it, expect } from 'vitest';
import { computeConfidenceBand } from './forecastConfidence';
import type { DensityFrame } from '../types';

function frame(atSec: number, density: Record<string, number>): DensityFrame {
  return { atSec, density, gateStatus: {} };
}

describe('computeConfidenceBand', () => {
  it('uses the sampled method and reflects real variance when frame data exists', () => {
    const frames: DensityFrame[] = [
      frame(0, { 'sec-101': 0.5 }),
      frame(60, { 'sec-101': 0.6 }),
      frame(120, { 'sec-101': 0.7 }),
      frame(180, { 'sec-101': 0.85 }),
      frame(240, { 'sec-101': 0.95 }),
      frame(300, { 'sec-101': 1.0 }),
    ];
    const pointPrediction = { density: 0.7, crossingSec: 120 };

    const band = computeConfidenceBand(pointPrediction, frames, 'sec-101');

    expect(band.method).toBe('sampled');
    // window around idx=2 (atSec 120) spans idx 0..4 -> densities 0.5..0.95
    expect(band.densityLow).toBeCloseTo(0.5, 5);
    expect(band.densityHigh).toBeCloseTo(0.95, 5);
    expect(band.crossingSecEarliest).toBe(0);
    expect(band.crossingSecLatest).toBe(240);
  });

  it('uses the heuristic method, correctly labeled, when no variance source exists', () => {
    const pointPrediction = { density: 0.8, crossingSec: 600 };

    const bandEmpty = computeConfidenceBand(pointPrediction, [], 'sec-101');
    expect(bandEmpty.method).toBe('heuristic');
    expect(bandEmpty.densityLow).toBeCloseTo(0.72, 5);
    expect(bandEmpty.densityHigh).toBeCloseTo(0.88, 5);
    expect(bandEmpty.crossingSecEarliest).toBeCloseTo(480, 5);
    expect(bandEmpty.crossingSecLatest).toBeCloseTo(720, 5);

    const bandSingleFrame = computeConfidenceBand(pointPrediction, [frame(600, { 'sec-101': 0.8 })], 'sec-101');
    expect(bandSingleFrame.method).toBe('heuristic');
  });

  it('always contains the point prediction within its range', () => {
    const pointPrediction = { density: 0.72, crossingSec: 150 };
    const frames: DensityFrame[] = [
      frame(0, { 'sec-101': 0.4 }),
      frame(60, { 'sec-101': 0.5 }),
      frame(120, { 'sec-101': 0.6 }),
    ];

    const sampled = computeConfidenceBand(pointPrediction, frames, 'sec-101');
    expect(sampled.densityLow).toBeLessThanOrEqual(pointPrediction.density);
    expect(sampled.densityHigh).toBeGreaterThanOrEqual(pointPrediction.density);
    expect(sampled.crossingSecEarliest).toBeLessThanOrEqual(pointPrediction.crossingSec);
    expect(sampled.crossingSecLatest).toBeGreaterThanOrEqual(pointPrediction.crossingSec);

    const heuristic = computeConfidenceBand(pointPrediction, [], 'sec-101');
    expect(heuristic.densityLow).toBeLessThanOrEqual(pointPrediction.density);
    expect(heuristic.densityHigh).toBeGreaterThanOrEqual(pointPrediction.density);
    expect(heuristic.crossingSecEarliest).toBeLessThanOrEqual(pointPrediction.crossingSec);
    expect(heuristic.crossingSecLatest).toBeGreaterThanOrEqual(pointPrediction.crossingSec);
  });
});
