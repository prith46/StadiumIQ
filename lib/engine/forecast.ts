export interface DensityFrame {
  atSec: number;                        // matchClockSec this frame represents
  density: Record<string, number>;      // zoneId -> 0..1
  gateStatus?: Record<string, 'open' | 'congested' | 'closed'>;
}

export interface ForecastResult {
  // Pure engine forecastAt fields
  requestedAtSec?: number;
  targetSec?: number;
  density?: Record<string, number>;

  // Glue getForecast fields
  zoneId?: string;
  minutesAhead?: number;
  predictedDensity?: number;

  // Common fields
  extrapolated: boolean;
}

export interface PeakCrushResult {
  // Pure engine findPeakCrush fields
  peakAtSec?: number;
  peakScore?: number;
  topZones?: Array<{ zoneId: string; density: number }>;

  // Glue getPeakCrush fields
  zoneId?: string;
  peakMatchClockSec?: number;
  peakDensity?: number;
  minutesFromNow?: number;
  extrapolated?: boolean;
}

export type ForecastSource =
  | {
      kind: 'timeline';
      frames: DensityFrame[];
    }
  | {
      kind: 'projection';
      currentDensity: Record<string, number>;
      projectFn: (zoneId: string, atMatchClockSec: number) => number;
    };

/**
 * Given a target lookahead (aheadSec), returns the predicted density per zone at that future point.
 * Performs linear interpolation between the two nearest frames, or clamps and extrapolates
 * if the requested lookahead is outside the timeline horizon.
 */
export function forecastAt(
  timeline: DensityFrame[],
  currentSec: number,
  aheadSec: number
): ForecastResult {
  const requestedAtSec = currentSec;
  const targetSec = currentSec + aheadSec;

  // Handle empty timeline
  if (timeline.length === 0) {
    return {
      requestedAtSec,
      targetSec,
      density: {},
      extrapolated: true,
    };
  }

  // Handle single frame timeline
  if (timeline.length === 1) {
    return {
      requestedAtSec,
      targetSec,
      density: { ...timeline[0].density },
      extrapolated: true,
    };
  }

  const firstFrame = timeline[0];
  const lastFrame = timeline[timeline.length - 1];

  // Handle extrapolation before the timeline starts
  if (targetSec < firstFrame.atSec) {
    return {
      requestedAtSec,
      targetSec,
      density: { ...firstFrame.density },
      extrapolated: true,
    };
  }

  // Handle extrapolation beyond the timeline ends
  if (targetSec > lastFrame.atSec) {
    return {
      requestedAtSec,
      targetSec,
      density: { ...lastFrame.density },
      extrapolated: true,
    };
  }

  // Handle exact frame match
  const exactMatch = timeline.find((f) => f.atSec === targetSec);
  if (exactMatch) {
    return {
      requestedAtSec,
      targetSec,
      density: { ...exactMatch.density },
      extrapolated: false,
    };
  }

  // Interpolation: find the two frames bracketing targetSec
  let i = 0;
  for (let j = 0; j < timeline.length - 1; j++) {
    if (timeline[j].atSec <= targetSec && targetSec < timeline[j + 1].atSec) {
      i = j;
      break;
    }
  }

  const frameA = timeline[i];
  const frameB = timeline[i + 1];

  const t = (targetSec - frameA.atSec) / (frameB.atSec - frameA.atSec);

  const zoneIds = new Set([
    ...Object.keys(frameA.density),
    ...Object.keys(frameB.density),
  ]);

  const density: Record<string, number> = {};
  for (const zoneId of zoneIds) {
    const valA = frameA.density[zoneId] ?? 0;
    const valB = frameB.density[zoneId] ?? 0;
    const val = valA + (valB - valA) * t;
    density[zoneId] = Math.max(0, Math.min(1, val));
  }

  return {
    requestedAtSec,
    targetSec,
    density,
    extrapolated: false,
  };
}

/**
 * Identifies the "peak crush time" - the future timestamp within a bounded horizon
 * (defaulting to 2400 seconds / 40 minutes) at which the aggregate crowd density is highest.
 */
export function findPeakCrush(
  timeline: DensityFrame[],
  currentSec: number,
  horizonSec: number = 2400 // default 40 minutes
): PeakCrushResult {
  // Handle empty timeline
  if (timeline.length === 0) {
    return {
      peakAtSec: currentSec,
      peakScore: 0,
      topZones: [],
    };
  }

  // Handle single frame timeline
  if (timeline.length === 1) {
    const frame = timeline[0];
    const score = Object.values(frame.density).reduce((sum, val) => sum + val, 0);
    const topZones = Object.entries(frame.density)
      .map(([zoneId, density]) => ({ zoneId, density }))
      .sort((a, b) => {
        if (b.density !== a.density) return b.density - a.density;
        return a.zoneId < b.zoneId ? -1 : a.zoneId > b.zoneId ? 1 : 0;
      })
      .slice(0, 5);

    return {
      peakAtSec: frame.atSec,
      peakScore: score,
      topZones,
    };
  }

  // Filter frames within the horizon window [currentSec, currentSec + horizonSec]
  let candidates = timeline.filter(
    (f) => f.atSec >= currentSec && f.atSec <= currentSec + horizonSec
  );

  // Fallback if no frames match: find the closest frame in the timeline
  if (candidates.length === 0) {
    let bestFrame = timeline[0];
    let minDiff = Math.abs(timeline[0].atSec - currentSec);
    for (let i = 1; i < timeline.length; i++) {
      const diff = Math.abs(timeline[i].atSec - currentSec);
      if (diff < minDiff) {
        minDiff = diff;
        bestFrame = timeline[i];
      }
    }
    candidates = [bestFrame];
  }

  // Find the candidate frame with the highest density score
  let peakFrame = candidates[0];
  let maxScore = -1;

  for (const frame of candidates) {
    const score = Object.values(frame.density).reduce((sum, val) => sum + val, 0);
    // Since the timeline is sorted by atSec ascending, using strictly greater (>)
    // ensures that we pick the earliest frame in case of a tie.
    if (score > maxScore) {
      maxScore = score;
      peakFrame = frame;
    }
  }

  // Generate top 5 zones sorted by density descending, then by zoneId ascending
  const topZones = Object.entries(peakFrame.density)
    .map(([zoneId, density]) => ({ zoneId, density }))
    .sort((a, b) => {
      if (b.density !== a.density) {
        return b.density - a.density; // descending
      }
      return a.zoneId < b.zoneId ? -1 : a.zoneId > b.zoneId ? 1 : 0; // ascending
    })
    .slice(0, 5);

  return {
    peakAtSec: peakFrame.atSec,
    peakScore: maxScore,
    topZones,
  };
}

/**
 * Service/helper-level crowd density forecast lookup for a single zone.
 */
export function getForecast(
  zoneId: string,
  minutesAhead: number,
  currentMatchClockSec: number,
  source: ForecastSource
): ForecastResult {
  const aheadSec = minutesAhead * 60;
  const targetSec = currentMatchClockSec + aheadSec;

  if (source.kind === 'timeline') {
    const res = forecastAt(source.frames, currentMatchClockSec, aheadSec);
    return {
      zoneId,
      minutesAhead,
      predictedDensity: res.density?.[zoneId] ?? 0,
      extrapolated: res.extrapolated,
    };
  } else {
    const predictedDensity = source.projectFn(zoneId, targetSec);
    return {
      zoneId,
      minutesAhead,
      predictedDensity,
      extrapolated: false,
    };
  }
}

/**
 * Service/helper-level peak crush lookup for a single zone.
 */
export function getPeakCrush(
  zoneId: string,
  currentMatchClockSec: number,
  source: ForecastSource,
  horizonMinutes?: number
): PeakCrushResult {
  const horizonSec = (horizonMinutes ?? 40) * 60;

  if (source.kind === 'timeline') {
    const timeline = source.frames;
    if (timeline.length === 0) {
      return {
        zoneId,
        peakMatchClockSec: currentMatchClockSec,
        peakDensity: 0,
        minutesFromNow: 0,
        extrapolated: true,
      };
    }

    let candidates = timeline.filter(
      (f) => f.atSec >= currentMatchClockSec && f.atSec <= currentMatchClockSec + horizonSec
    );

    if (candidates.length === 0) {
      let bestFrame = timeline[0];
      let minDiff = Math.abs(timeline[0].atSec - currentMatchClockSec);
      for (let i = 1; i < timeline.length; i++) {
        const diff = Math.abs(timeline[i].atSec - currentMatchClockSec);
        if (diff < minDiff) {
          minDiff = diff;
          bestFrame = timeline[i];
        }
      }
      candidates = [bestFrame];
    }

    let peakFrame = candidates[0];
    let maxDensity = -1;
    for (const frame of candidates) {
      const d = frame.density[zoneId] ?? 0;
      if (d > maxDensity) {
        maxDensity = d;
        peakFrame = frame;
      }
    }

    const minutesFromNow = Math.round((peakFrame.atSec - currentMatchClockSec) / 60);

    return {
      zoneId,
      peakMatchClockSec: peakFrame.atSec,
      peakDensity: maxDensity,
      minutesFromNow,
      extrapolated: false,
    };
  } else {
    // projection
    let peakMatchClockSec = currentMatchClockSec;
    let maxDensity = -1;
    for (let sec = currentMatchClockSec; sec <= currentMatchClockSec + horizonSec; sec += 300) {
      const d = source.projectFn(zoneId, sec);
      if (d > maxDensity) {
        maxDensity = d;
        peakMatchClockSec = sec;
      }
    }

    const minutesFromNow = Math.round((peakMatchClockSec - currentMatchClockSec) / 60);

    return {
      zoneId,
      peakMatchClockSec,
      peakDensity: maxDensity,
      minutesFromNow,
      extrapolated: false,
    };
  }
}

/**
 * Service/helper-level batch forecast lookup for all zones.
 */
export function getForecastForAllZones(
  minutesAhead: number,
  currentMatchClockSec: number,
  source: ForecastSource,
  zoneIds: string[]
): Record<string, number> {
  const aheadSec = minutesAhead * 60;
  const targetSec = currentMatchClockSec + aheadSec;

  if (source.kind === 'timeline') {
    const res = forecastAt(source.frames, currentMatchClockSec, aheadSec);
    return res.density ?? {};
  } else {
    const result: Record<string, number> = {};
    for (const zoneId of zoneIds) {
      result[zoneId] = source.projectFn(zoneId, targetSec);
    }
    return result;
  }
}
