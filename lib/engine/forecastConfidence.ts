import type { DensityFrame } from '../types';

// Frames on either side of the nearest-to-crossing frame to sample when real
// timeline variance data exists.
const SAMPLE_WINDOW_FRAMES = 2;

// Heuristic fallback bounds, used only when no real variance source exists
// in the timeline (e.g. too few frames to sample). Documented, not invented
// per-call — see docs/forecast-confidence.md.
const HEURISTIC_DENSITY_PCT = 0.10; // ±10% of density
const HEURISTIC_TIME_PCT = 0.20; // ±20% of time

export interface ConfidenceBand {
  densityLow: number;
  densityHigh: number;
  crossingSecEarliest: number;
  crossingSecLatest: number;
  method: 'sampled' | 'heuristic';
}

export interface PointPrediction {
  density: number;
  crossingSec: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Pure, synchronous confidence band around a single forecast point
 * prediction. Extends (never replaces) the point prediction from
 * `lib/engine/forecast.ts` — that module's prediction logic is untouched.
 */
export function computeConfidenceBand(
  pointPrediction: PointPrediction,
  frames: DensityFrame[],
  zoneId: string
): ConfidenceBand {
  return sampleFromFrames(pointPrediction, frames, zoneId) ?? heuristicBand(pointPrediction);
}

/**
 * Samples the real timeline's density values in a small window around the
 * predicted crossing time. Returns null (falling back to the heuristic) if
 * there isn't enough distinct frame data to call this a real sample — e.g.
 * an empty or single-frame timeline has no variance to observe.
 */
function sampleFromFrames(
  pointPrediction: PointPrediction,
  frames: DensityFrame[],
  zoneId: string
): ConfidenceBand | null {
  if (frames.length < 2) return null;

  let centerIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const diff = Math.abs(frames[i].atSec - pointPrediction.crossingSec);
    if (diff < minDiff) {
      minDiff = diff;
      centerIdx = i;
    }
  }

  const startIdx = Math.max(0, centerIdx - SAMPLE_WINDOW_FRAMES);
  const endIdx = Math.min(frames.length - 1, centerIdx + SAMPLE_WINDOW_FRAMES);
  const window = frames.slice(startIdx, endIdx + 1);
  if (window.length < 2) return null;

  const densities = window
    .map((f) => f.density[zoneId])
    .filter((d): d is number => typeof d === 'number');
  if (densities.length < 2) return null;

  const densityLow = clamp01(Math.min(...densities, pointPrediction.density));
  const densityHigh = clamp01(Math.max(...densities, pointPrediction.density));
  const crossingSecEarliest = Math.min(window[0].atSec, pointPrediction.crossingSec);
  const crossingSecLatest = Math.max(window[window.length - 1].atSec, pointPrediction.crossingSec);

  return {
    densityLow,
    densityHigh,
    crossingSecEarliest,
    crossingSecLatest,
    method: 'sampled',
  };
}

/**
 * Documented heuristic fallback (±10% density, ±20% time) used only when no
 * real variance source exists in the timeline. `method: 'heuristic'` is
 * always set honestly — never disguised as `'sampled'`.
 */
function heuristicBand(pointPrediction: PointPrediction): ConfidenceBand {
  const { density, crossingSec } = pointPrediction;
  return {
    densityLow: clamp01(density * (1 - HEURISTIC_DENSITY_PCT)),
    densityHigh: clamp01(density * (1 + HEURISTIC_DENSITY_PCT)),
    crossingSecEarliest: Math.max(0, crossingSec * (1 - HEURISTIC_TIME_PCT)),
    crossingSecLatest: crossingSec * (1 + HEURISTIC_TIME_PCT),
    method: 'heuristic',
  };
}
