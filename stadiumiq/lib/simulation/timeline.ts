import { Zone, DensityFrame } from '../types';
import {
  MATCH_START_SEC,
  FULL_TIME_END_SEC,
  TIMELINE_FRAME_STEP_SEC,
  computeBaseDensity,
  computeGateStatus,
} from './engine';

export function generateTimeline(zones: Zone[], seed: number): DensityFrame[] {
  const frames: DensityFrame[] = [];
  
  for (let atSec = MATCH_START_SEC; atSec <= FULL_TIME_END_SEC; atSec += TIMELINE_FRAME_STEP_SEC) {
    const density: Record<string, number> = {};
    const gateStatus: Record<string, 'open' | 'congested' | 'closed'> = {};
    
    for (const zone of zones) {
      density[zone.id] = computeBaseDensity(zone, atSec, seed);
      if (zone.type === 'gate') {
        gateStatus[zone.id] = computeGateStatus(zone, density[zone.id]);
      }
    }
    
    frames.push({
      atSec,
      density,
      gateStatus,
    });
  }
  
  return frames;
}

export function nearestFrame(timeline: DensityFrame[], targetSec: number): DensityFrame {
  if (timeline.length === 0) {
    throw new Error('Timeline is empty');
  }

  let low = 0;
  let high = timeline.length - 1;

  while (low < high - 1) {
    const mid = Math.floor((low + high) / 2);
    if (timeline[mid].atSec <= targetSec) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const diffLow = Math.abs(timeline[low].atSec - targetSec);
  const diffHigh = Math.abs(timeline[high].atSec - targetSec);

  if (diffLow <= diffHigh) {
    return timeline[low];
  } else {
    return timeline[high];
  }
}
