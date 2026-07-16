import { describe, it, expect } from 'vitest';
import {
  computeSequencerState,
  ingressDensityForZone,
  egressDensityForZone,
  PRE_MATCH_DURATION_SEC,
  LIVE_PHASE_END_SEC,
  POST_PHASE_END_SEC,
  EGRESS_DURATION_SEC,
} from './matchSequencer';

describe('computeSequencerState', () => {
  it('produces identical output for two independent calls given the same seed + start + now (cross-tab determinism)', () => {
    const seed = 12345;
    const sessionStartedAtMs = 1_700_000_000_000;
    const nowMs = sessionStartedAtMs + 250_000;

    const a = computeSequencerState(seed, sessionStartedAtMs, nowMs);
    const b = computeSequencerState(seed, sessionStartedAtMs, nowMs);

    expect(b).toEqual(a);
  });

  it('transitions phases at the correct elapsed-time boundaries', () => {
    const seed = 1;
    const start = 0;

    expect(computeSequencerState(seed, start, (PRE_MATCH_DURATION_SEC - 1) * 1000).phase).toBe('pre');
    expect(computeSequencerState(seed, start, PRE_MATCH_DURATION_SEC * 1000).phase).toBe('live');
    expect(computeSequencerState(seed, start, (LIVE_PHASE_END_SEC - 1) * 1000).phase).toBe('live');
    expect(computeSequencerState(seed, start, LIVE_PHASE_END_SEC * 1000).phase).toBe('post');
    expect(computeSequencerState(seed, start, (POST_PHASE_END_SEC - 1) * 1000).phase).toBe('post');
    expect(computeSequencerState(seed, start, POST_PHASE_END_SEC * 1000).phase).toBe('idle');
  });

  it('counts the pre-match clock down, then re-baselines to 0 at live start and counts up continuously through post', () => {
    const seed = 1;
    const start = 0;

    expect(computeSequencerState(seed, start, 0).matchClockSec).toBe(120);
    expect(computeSequencerState(seed, start, 30_000).matchClockSec).toBe(90);
    // Live starts fresh at 0 (not 120) the instant pre-match ends.
    expect(computeSequencerState(seed, start, PRE_MATCH_DURATION_SEC * 1000).matchClockSec).toBe(0);
    expect(computeSequencerState(seed, start, 200_000).matchClockSec).toBe(80);
    // Post continues the live count with no further reset.
    expect(computeSequencerState(seed, start, LIVE_PHASE_END_SEC * 1000).matchClockSec).toBe(300);
  });
});

describe('ingress/egress density curves', () => {
  it('ramps gradually, not instantly, between adjacent seconds', () => {
    const zoneId = 'sec-101';
    const seed = 99;

    let maxDelta = 0;
    let prev = ingressDensityForZone(zoneId, seed, 0);
    for (let t = 1; t <= PRE_MATCH_DURATION_SEC; t++) {
      const next = ingressDensityForZone(zoneId, seed, t);
      maxDelta = Math.max(maxDelta, Math.abs(next - prev));
      prev = next;
    }

    expect(maxDelta).toBeLessThan(0.1);
    // and it does actually move somewhere over the full window (not flat)
    expect(ingressDensityForZone(zoneId, seed, PRE_MATCH_DURATION_SEC)).toBeGreaterThan(
      ingressDensityForZone(zoneId, seed, 0)
    );
  });

  it('egress surges immediately (Fix 4), then declines gradually to calm (Fix 5), never jumping instantly', () => {
    const zoneId = 'sec-101';
    const seed = 99;

    let maxDelta = 0;
    let prev = egressDensityForZone(zoneId, seed, 0);
    for (let t = 1; t <= EGRESS_DURATION_SEC; t++) {
      const next = egressDensityForZone(zoneId, seed, t);
      maxDelta = Math.max(maxDelta, Math.abs(next - prev));
      prev = next;
    }
    expect(maxDelta).toBeLessThan(0.1);

    // Surge: an early point should be well above the pre-surge baseline.
    expect(egressDensityForZone(zoneId, seed, 20)).toBeGreaterThan(egressDensityForZone(zoneId, seed, 0));
    // Decline: fully calm by the end of the egress window.
    expect(egressDensityForZone(zoneId, seed, EGRESS_DURATION_SEC)).toBeLessThan(0.1);
  });

  it('produces different per-zone jitter for different seeds', () => {
    const zoneId = 'sec-101';
    const midT = 40;

    const a = ingressDensityForZone(zoneId, 1, midT);
    const b = ingressDensityForZone(zoneId, 2, midT);

    expect(a).not.toBeCloseTo(b, 5);
  });
});
