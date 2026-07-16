import { describe, it, expect } from 'vitest';
import { resolveOverriddenDensity, ManualOverride, OVERRIDE_HOLD_SEC, OVERRIDE_DECAY_SEC } from './overrideDecay';

describe('resolveOverriddenDensity', () => {
  const zoneId = 'sec-101';
  const holdSec = OVERRIDE_HOLD_SEC; // 30
  const decaySec = OVERRIDE_DECAY_SEC; // 20

  it('returns autoComputedValue exactly if no override exists', () => {
    const res = resolveOverriddenDensity(zoneId, undefined, 0.4, Date.now(), holdSec, decaySec);
    expect(res).toBe(0.4);
  });

  it('returns manual value exactly immediately after set', () => {
    const now = Date.now();
    const override: ManualOverride = { value: 0.9, setAtMs: now };
    const res = resolveOverriddenDensity(zoneId, override, 0.3, now, holdSec, decaySec);
    expect(res).toBe(0.9);
  });

  it('returns manual value exactly during the hold phase (e.g. 15s elapsed)', () => {
    const now = Date.now();
    const override: ManualOverride = { value: 0.9, setAtMs: now - 15000 };
    const res = resolveOverriddenDensity(zoneId, override, 0.3, now, holdSec, decaySec);
    expect(res).toBe(0.9);
  });

  it('returns interpolated value strictly between manual and auto values during decay phase (e.g. 35s elapsed, t=0.25)', () => {
    const now = Date.now();
    // 35 seconds elapsed (30s hold, 5s into 20s decay, t=0.25)
    const override: ManualOverride = { value: 1.0, setAtMs: now - 35000 };
    const autoVal = 0.2;
    const res = resolveOverriddenDensity(zoneId, override, autoVal, now, holdSec, decaySec);
    // Expected: 1.0 + 0.25 * (0.2 - 1.0) = 1.0 - 0.2 = 0.8
    expect(res).toBeCloseTo(0.8, 5);
  });

  it('returns auto-computed value exactly after hold + decay window elapses', () => {
    const now = Date.now();
    // 51 seconds elapsed (past 50s total window)
    const override: ManualOverride = { value: 1.0, setAtMs: now - 51000 };
    const res = resolveOverriddenDensity(zoneId, override, 0.35, now, holdSec, decaySec);
    expect(res).toBe(0.35);
  });

  it('returns manual value exactly even after decay window if isGodMode is true', () => {
    const now = Date.now();
    // 60 seconds elapsed, but isGodMode is set
    const override: ManualOverride = { value: 0.9, setAtMs: now - 60000, isGodMode: true };
    const res = resolveOverriddenDensity(zoneId, override, 0.3, now, holdSec, decaySec);
    expect(res).toBe(0.9);
  });
});
