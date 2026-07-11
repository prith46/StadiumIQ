import { useSimStore } from '../store/simStore';
import { ZONES } from '../venue/venue';
import { computeBaseDensity } from '../simulation/engine';
import {
  getForecast,
  getPeakCrush,
  getForecastForAllZones,
  ForecastSource,
  ForecastResult,
  PeakCrushResult,
} from './forecast';

/**
 * forecastService.ts
 *
 * Thin store-reading glue that binds the pure forecasting engine (forecast.ts)
 * to the simulation store state.
 *
 * This is the ONLY forecast-engine related file that imports from Zustand.
 */

/**
 * Detects the active ForecastSource kind based on current simStore timeline.
 * If timeline is populated, returns the timeline branch.
 * If empty, returns the synthetic projection branch utilizing F3's computeBaseDensity.
 */
export function getActiveForecastSource(): ForecastSource {
  const { timeline, density } = useSimStore.getState();

  if (timeline && timeline.length > 0) {
    return {
      kind: 'timeline',
      frames: timeline,
    };
  }

  // Fallback branch if timeline is empty/unseeded (e.g. initial setup)
  return {
    kind: 'projection',
    currentDensity: density,
    projectFn: (zoneId: string, atMatchClockSec: number) => {
      const zone = ZONES.find((z) => z.id === zoneId);
      if (!zone) return 0;
      // Re-uses simulation engine's base density calculator for bit-for-bit consistency
      return computeBaseDensity(zone, atMatchClockSec);
    },
  };
}

/**
 * Service-level crowd density forecast lookup.
 */
export function getForecastService(zoneId: string, minutesAhead: number): ForecastResult {
  const currentMatchClockSec = useSimStore.getState().matchClockSec;
  const source = getActiveForecastSource();
  return getForecast(zoneId, minutesAhead, currentMatchClockSec, source);
}

/**
 * Service-level peak crush lookup.
 */
export function getPeakCrushService(zoneId: string, horizonMinutes?: number): PeakCrushResult {
  const currentMatchClockSec = useSimStore.getState().matchClockSec;
  const source = getActiveForecastSource();
  return getPeakCrush(zoneId, currentMatchClockSec, source, horizonMinutes);
}

/**
 * Service-level batch forecast lookup for all zones.
 */
export function getForecastForAllZonesService(minutesAhead: number): Record<string, number> {
  const currentMatchClockSec = useSimStore.getState().matchClockSec;
  const source = getActiveForecastSource();
  const zoneIds = ZONES.map((z) => z.id);
  return getForecastForAllZones(minutesAhead, currentMatchClockSec, source, zoneIds);
}
