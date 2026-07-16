import { Zone, SimState, SimConfig, MatchPhase } from '../types';
import { decayRoutedLoad as externalDecayRoutedLoad } from '../engine/loadBalance';

export const MATCH_START_SEC = -1800;   // pre-match window opens 30 min before kickoff
export const FIRST_HALF_END_SEC = 2700; // 45:00
export const HALFTIME_END_SEC = 3600;   // 15 min halftime
export const SECOND_HALF_END_SEC = 6300; // 45:00 more
export const FULL_TIME_END_SEC = 8100;   // 30 min post-match egress window; simulation caps here

export const DEFAULT_SIM_CONFIG: SimConfig = {
  tickIntervalMs: 2000,
  simSecondsPerTick: 45,
  seed: 20260710,
};

export const TIMELINE_FRAME_STEP_SEC = 60;       // one pre-generated frame per 60 sim-seconds
export const SENSOR_SATURATION = 8;              // live sessions in a zone to reach max sensor influence
export const SENSOR_WEIGHT = 0.3;                // blend weight of sensor influence vs base density
export const ROUTED_LOAD_DECAY = 0.9;            // multiplicative decay of routedLoad per tick
export const GATE_CONGESTION_THRESHOLD = 0.7;    // gate zone density above this => 'congested'
export const SESSION_TTL_MS = 10000;             // heartbeat considered stale after this long

export function matchPhase(matchClockSec: number): MatchPhase {
  if (matchClockSec < 0) return 'pre';
  if (matchClockSec < FIRST_HALF_END_SEC) return 'firstHalf';
  if (matchClockSec < HALFTIME_END_SEC) return 'half';
  if (matchClockSec < SECOND_HALF_END_SEC) return 'secondHalf';
  return 'fullTime';
}

export function phaseProgress(matchClockSec: number): number {
  let progress = 0;
  if (matchClockSec < 0) {
    // pre: MATCH_START_SEC (-1800) to 0
    progress = (matchClockSec - MATCH_START_SEC) / -MATCH_START_SEC;
  } else if (matchClockSec < FIRST_HALF_END_SEC) {
    // firstHalf: 0 to FIRST_HALF_END_SEC (2700)
    progress = matchClockSec / FIRST_HALF_END_SEC;
  } else if (matchClockSec < HALFTIME_END_SEC) {
    // half: FIRST_HALF_END_SEC (2700) to HALFTIME_END_SEC (3600)
    progress = (matchClockSec - FIRST_HALF_END_SEC) / (HALFTIME_END_SEC - FIRST_HALF_END_SEC);
  } else if (matchClockSec < SECOND_HALF_END_SEC) {
    // secondHalf: HALFTIME_END_SEC (3600) to SECOND_HALF_END_SEC (6300)
    progress = (matchClockSec - HALFTIME_END_SEC) / (SECOND_HALF_END_SEC - HALFTIME_END_SEC);
  } else {
    // fullTime: SECOND_HALF_END_SEC (6300) to FULL_TIME_END_SEC (8100)
    progress = (matchClockSec - SECOND_HALF_END_SEC) / (FULL_TIME_END_SEC - SECOND_HALF_END_SEC);
  }
  return Math.min(1, Math.max(0, progress));
}

export function mulberry32(seed: number): () => number {
  let a = seed;
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashZoneId(zoneId: string): number {
  let hash = 0;
  for (let i = 0; i < zoneId.length; i++) {
    hash = (hash * 31 + zoneId.charCodeAt(i)) | 0;
  }
  return hash;
}

export function computeBaseDensity(zone: Zone, matchClockSec: number, seed?: number): number {
  const phase = matchPhase(matchClockSec);
  const progress = phaseProgress(matchClockSec);
  let target = 0;

  if (zone.type === 'section') {
    switch (phase) {
      case 'pre':
        target = 0.0 + progress * 0.6;
        break;
      case 'firstHalf':
        if (progress < 0.2) {
          target = 0.6 + (progress / 0.2) * 0.3;
        } else {
          target = 0.9;
        }
        break;
      case 'half':
        target = 0.9 - progress * 0.6;
        break;
      case 'secondHalf':
        if (progress < 0.2) {
          target = 0.3 + (progress / 0.2) * 0.6;
        } else {
          target = 0.9;
        }
        break;
      case 'fullTime':
        target = 0.9 - progress * 0.85;
        break;
    }
  } else if (zone.type === 'concourse' || zone.type === 'gate' || zone.type === 'transit') {
    switch (phase) {
      case 'pre':
        target = 0.0 + progress * 0.5;
        break;
      case 'firstHalf':
        target = 0.5 - progress * 0.35;
        break;
      case 'half':
        target = 0.15 + progress * 0.75;
        break;
      case 'secondHalf':
        target = 0.9 - progress * 0.75;
        break;
      case 'fullTime':
        if (progress < 0.4) {
          target = 0.15 + (progress / 0.4) * 0.8;
        } else {
          target = 0.95 - ((progress - 0.4) / 0.6) * 0.85;
        }
        break;
    }
  } else if (zone.type === 'field') {
    target = 0;
  }

  if (zone.type === 'field') {
    return 0;
  }

  const baseSeed = hashZoneId(zone.id);
  const finalSeed = seed !== undefined ? (baseSeed ^ seed) >>> 0 : baseSeed;
  const gen = mulberry32(finalSeed);
  const jitter = (gen() * 0.1) - 0.05;

  return Math.min(1, Math.max(0, target + jitter));
}

export function blendSensorInfluence(baseDensity: number, sensorCount: number): number {
  const influence = Math.min(1, sensorCount / SENSOR_SATURATION);
  const blended = baseDensity * (1 - SENSOR_WEIGHT) + influence * SENSOR_WEIGHT;
  return Math.min(1, Math.max(0, blended));
}

export function computeGateStatus(
  zone: Zone,
  density: number,
  override?: 'open' | 'congested' | 'closed'
): 'open' | 'congested' | 'closed' {
  if (override !== undefined) {
    return override;
  }
  return density > GATE_CONGESTION_THRESHOLD ? 'congested' : 'open';
}

export function decayRoutedLoad(routedLoad: Record<string, number>): Record<string, number> {
  return externalDecayRoutedLoad(routedLoad, ROUTED_LOAD_DECAY);
}

export function pruneAndCountSessions(
  heartbeats: Record<string, Record<string, number>>,
  nowMs: number
): { pruned: Record<string, Record<string, number>>; counts: Record<string, number> } {
  const pruned: Record<string, Record<string, number>> = {};
  const counts: Record<string, number> = {};

  for (const [zoneId, sessions] of Object.entries(heartbeats)) {
    const newSessions: Record<string, number> = {};
    let count = 0;
    for (const [sessionId, lastSeenMs] of Object.entries(sessions)) {
      if (nowMs - lastSeenMs <= SESSION_TTL_MS) {
        newSessions[sessionId] = lastSeenMs;
        count++;
      }
    }
    if (count > 0) {
      pruned[zoneId] = newSessions;
      counts[zoneId] = count;
    }
  }

  return { pruned, counts };
}

export function mergeStatePatch(state: SimState, patch: Partial<SimState>): SimState {
  return {
    matchClockSec: patch.matchClockSec !== undefined ? patch.matchClockSec : state.matchClockSec,
    density: { ...state.density, ...patch.density },
    gateStatus: { ...state.gateStatus, ...patch.gateStatus },
    incidents: patch.incidents !== undefined ? [...patch.incidents] : state.incidents,
    routedLoad: { ...state.routedLoad, ...patch.routedLoad },
    sensorCounts: { ...state.sensorCounts, ...patch.sensorCounts },
    timeline: patch.timeline !== undefined ? [...patch.timeline] : state.timeline,
  };
}
