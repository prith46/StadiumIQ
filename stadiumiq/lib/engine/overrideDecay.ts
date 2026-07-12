export interface ManualOverride {
  value: number;
  setAtMs: number;
  isGodMode?: boolean;
}

export const OVERRIDE_HOLD_SEC = 30;
export const OVERRIDE_DECAY_SEC = 20;

/**
 * Resolves the density value for a zone by keeping the manual override static during the
 * hold phase, then interpolating to the auto-computed value during the decay phase.
 */
export function resolveOverriddenDensity(
  zoneId: string,
  override: ManualOverride | undefined,
  autoComputedValue: number,
  nowMs: number,
  holdSec: number,
  decaySec: number
): number {
  if (!override) {
    return autoComputedValue;
  }

  if (override.isGodMode) {
    return override.value;
  }

  const elapsedSec = (nowMs - override.setAtMs) / 1000;

  if (elapsedSec < 0) {
    return override.value;
  }

  if (elapsedSec < holdSec) {
    return override.value;
  }

  if (elapsedSec >= holdSec + decaySec) {
    return autoComputedValue;
  }

  // Linear interpolation: from override.value (at holdSec) to autoComputedValue (at holdSec + decaySec)
  const t = (elapsedSec - holdSec) / decaySec;
  return override.value + t * (autoComputedValue - override.value);
}
