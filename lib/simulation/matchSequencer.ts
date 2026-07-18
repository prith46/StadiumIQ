import { hashZoneId, mulberry32 } from './engine';

// M29: automatic match sequencer — client-side demo timing, distinct from
// (and layered on top of) the existing full-match `MatchPhase` model in
// `engine.ts`. Phase durations are wall-clock seconds, not sim-accelerated.
export const PRE_MATCH_DURATION_SEC = 120; // 2 min pre-match ingress countdown
export const LIVE_MATCH_DURATION_SEC = 300; // 5 min live steady-state window
// Fix 5: widened from 90s so the Fix 4 surge sub-phase + decline can fit the
// stated targets (red gone by egress+60s, fully green by egress+120s).
export const EGRESS_DURATION_SEC = 120; // post-match egress ramp-down window
export const MATCH_END_ALERT_LEAD_SEC = 60; // M6 trigger: fire N sec before live phase ends
// Fix 4: length of the immediate crowd-surge sub-phase at the start of egress,
// before the gradual decline begins.
export const EGRESS_SURGE_DURATION_SEC = 45;

export const LIVE_PHASE_END_SEC = PRE_MATCH_DURATION_SEC + LIVE_MATCH_DURATION_SEC; // 420
export const POST_PHASE_END_SEC = LIVE_PHASE_END_SEC + EGRESS_DURATION_SEC; // 540

// Golden-ratio-derived salt to decorrelate egress per-zone jitter from ingress
// jitter (same zone, same seed, different staggering for filling vs draining).
const EGRESS_SALT = 0x9e3779b9;
// Fix 3: distinct salt for live-phase spike selection, decorrelated from both
// ingress and egress staggering.
const LIVE_SALT = 0x85ebca6b;
// Fix 8: salt for the live-phase auto-incident schedule.
const INCIDENT_SALT = 0x27d4eb2f;

export type SequencerPhase = 'pre' | 'live' | 'post' | 'idle';

export interface SequencerState {
  seed: number;
  phase: SequencerPhase;
  matchClockSec: number;
  sessionStartedAtMs: number;
}

/**
 * Generates a fresh random seed and marks "now" as session start. Only
 * called by the tab that starts a session (no existing broadcast state to
 * join) — every other tab adopts the broadcast `{ seed, sessionStartedAtMs }`
 * instead of calling this.
 */
export function initSequencer(): SequencerState {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const sessionStartedAtMs = Date.now();
  return computeSequencerState(seed, sessionStartedAtMs, sessionStartedAtMs);
}

/**
 * Pure: derives the current phase/clock purely from elapsed wall time. Given
 * the same `(seed, sessionStartedAtMs, nowMs)`, every tab (independently)
 * computes the identical result — this is the entire cross-tab sync
 * mechanism; see docs/STADIUMIQ-MASTER-DOCUMENTATION.md §4 (M29).
 */
export function computeSequencerState(seed: number, sessionStartedAtMs: number, nowMs: number): SequencerState {
  const elapsedSec = Math.max(0, (nowMs - sessionStartedAtMs) / 1000);

  let phase: SequencerPhase;
  let matchClockSec: number;

  // Fix 6: pre-match is its own 120->0 countdown; live re-baselines to a
  // fresh 0 the instant it starts, then counts up continuously through post
  // (no further resets) — rather than live/post continuing the elapsed-time
  // value that includes the pre-match window.
  if (elapsedSec < PRE_MATCH_DURATION_SEC) {
    phase = 'pre';
    matchClockSec = PRE_MATCH_DURATION_SEC - elapsedSec; // counts DOWN 120 -> 0
  } else if (elapsedSec < LIVE_PHASE_END_SEC) {
    phase = 'live';
    matchClockSec = elapsedSec - PRE_MATCH_DURATION_SEC; // fresh count, 0 -> 300
  } else if (elapsedSec < POST_PHASE_END_SEC) {
    phase = 'post';
    matchClockSec = elapsedSec - PRE_MATCH_DURATION_SEC; // continues, 300 -> 390
  } else {
    phase = 'idle';
    matchClockSec = POST_PHASE_END_SEC - PRE_MATCH_DURATION_SEC; // holds at the calm resting value
  }

  return { seed, phase, matchClockSec, sessionStartedAtMs };
}

function seededZoneRand(zoneId: string, seed: number, salt: number = 0): () => number {
  const zoneSeed = (hashZoneId(zoneId) ^ seed ^ salt) >>> 0;
  return mulberry32(zoneSeed);
}

export interface ScheduledLiveIncident {
  atSec: number; // live-phase-relative matchClockSec (0 -> LIVE_MATCH_DURATION_SEC) to fire at
  zoneId: string;
  type: 'crowd' | 'medical' | 'assistance' | 'security';
}

/**
 * Fix 8: deterministically schedules 1-2 auto-generated incidents (seeded,
 * capped so demos aren't spammed) at randomized points/zones during the live
 * phase. Callers create the actual `Incident` via the existing
 * applyScenario-based creation path (same one GodMode/fan-SOS use) — this
 * only decides *when/where/what type*.
 */
export function getScheduledLiveIncidents(seed: number, zoneIds: string[]): ScheduledLiveIncident[] {
  if (zoneIds.length === 0) return [];

  const rand = mulberry32((seed ^ INCIDENT_SALT) >>> 0);
  const count = rand() < 0.5 ? 1 : 2;
  const types: ScheduledLiveIncident['type'][] = ['crowd', 'medical', 'assistance', 'security'];

  const incidents: ScheduledLiveIncident[] = [];
  for (let i = 0; i < count; i++) {
    const atSec = 30 + rand() * (LIVE_MATCH_DURATION_SEC - 60);
    const zoneId = zoneIds[Math.floor(rand() * zoneIds.length)];
    const type = types[Math.floor(rand() * types.length)];
    incidents.push({ atSec, zoneId, type });
  }
  return incidents.sort((a, b) => a.atSec - b.atSec);
}

/**
 * Gradual, seeded per-zone ingress ramp for the pre-match phase: each zone
 * gets its own randomized start delay (0-30% into the window) and fill
 * speed (0.7x-1.3x), so zones don't all fill in lockstep — some fill first
 * or faster than others, deterministically from `seed`.
 */
export function ingressDensityForZone(zoneId: string, seed: number, phaseElapsedSec: number): number {
  const rand = seededZoneRand(zoneId, seed);
  const startDelayFrac = rand() * 0.3;
  const speedFactor = 0.7 + rand() * 0.6;
  // Fix 1: raised from 0.85 — `blendSensorInfluence` (0 sensors present in
  // most zones pre-match) damps whatever this returns by 30%, so a 0.85
  // target never actually surfaced as a red (>0.7) zone post-blend. 1.0
  // lets the fastest-filling zones actually cross red after blending.
  const target = 1.0;

  const rawProgress =
    ((phaseElapsedSec / PRE_MATCH_DURATION_SEC - startDelayFrac) * speedFactor) / (1 - startDelayFrac);
  const progress = Math.max(0, Math.min(1, rawProgress));

  return Math.max(0, Math.min(1, target * progress));
}

/**
 * Fix 3: live-phase density — a calm (mostly green) baseline per zone with
 * occasional randomized orange/red spikes that shift every ~60s. Bucketing
 * `phaseElapsedSec` into 60s windows and re-salting per bucket means each
 * zone's spike/calm roll changes discretely every ~60s rather than drifting
 * continuously — deliberately not a third continuous ramp curve.
 */
export function liveDensityForZone(zoneId: string, seed: number, phaseElapsedSec: number): number {
  const bucket = Math.floor(Math.max(0, phaseElapsedSec) / 60);
  const rand = seededZoneRand(zoneId, seed, (LIVE_SALT ^ bucket) >>> 0);
  const roll = rand();
  const baseline = 0.35 + rand() * 0.1; // calm/green

  if (roll < 0.15) {
    return 0.9 + rand() * 0.1; // occasional red spike
  }
  if (roll < 0.35) {
    return 0.55 + rand() * 0.15; // occasional orange/mild spike
  }
  return baseline;
}

/**
 * Mirror of `ingressDensityForZone` for the post-match egress: each zone
 * first gets an immediate crowd SURGE (concourses/gates spike toward red) for
 * the first `EGRESS_SURGE_DURATION_SEC`, staggered per zone, then declines
 * gradually back toward empty — rather than fading straight down with no
 * surge. Uses a different salt so a zone's egress stagger isn't identical to
 * its ingress stagger.
 */
export function egressDensityForZone(zoneId: string, seed: number, phaseElapsedSec: number): number {
  const rand = seededZoneRand(zoneId, seed, EGRESS_SALT);
  const startDelayFrac = rand() * 0.2;
  const surgePeak = 0.85 + rand() * 0.15; // 0.85 - 1.0
  const zoneSurgeEndSec = EGRESS_SURGE_DURATION_SEC * (1 - startDelayFrac * 0.5);

  if (phaseElapsedSec <= zoneSurgeEndSec) {
    const t = zoneSurgeEndSec > 0 ? Math.min(1, phaseElapsedSec / zoneSurgeEndSec) : 1;
    const liveBaseline = 0.35;
    return Math.max(0, Math.min(1, liveBaseline + (surgePeak - liveBaseline) * t));
  }

  const declineElapsed = phaseElapsedSec - zoneSurgeEndSec;
  const declineDuration = Math.max(1, EGRESS_DURATION_SEC - zoneSurgeEndSec);
  const progress = Math.max(0, Math.min(1, declineElapsed / declineDuration));

  return Math.max(0, Math.min(1, surgePeak * (1 - progress)));
}
