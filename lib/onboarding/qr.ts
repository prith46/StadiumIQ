import { ZONES } from '../venue/venue';

export interface QrSeatBlockPayload {
  v: number;
  type: string;
  zoneId: string;
}

/**
 * Parses and validates onboarding QR payloads.
 * Strictly checks payload size, JSON format, structure, and zone validation.
 */
export function parseQrPayload(raw: string): { zoneId: string } | null {
  // 1. Enforce payload limit of 500 bytes (character length since it is UTF-16/ASCII here)
  if (!raw || raw.length > 500) {
    return null;
  }

  // 2. Safely parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  // 3. Perform type checks
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.v !== 1) {
    return null;
  }

  if (obj.type !== 'seat-block') {
    return null;
  }

  if (typeof obj.zoneId !== 'string') {
    return null;
  }

  const zoneId = obj.zoneId;

  // 4. Validate zoneId exists in ZONES and type is 'section'
  const matchingZone = ZONES.find(z => z.id === zoneId);
  if (!matchingZone || matchingZone.type !== 'section') {
    return null;
  }

  return { zoneId };
}

/**
 * Generates a valid JSON demo QR payload for onboarding.
 */
export function generateDemoQrPayload(zoneId: string): string {
  const payload: QrSeatBlockPayload = {
    v: 1,
    type: 'seat-block',
    zoneId,
  };
  return JSON.stringify(payload);
}

export interface ScannedIncentive {
  fromZone: string;
  toZone: string;
  reward: string;
}

/**
 * Validates and decodes incentive QR payloads.
 * Checks version, type, size (500 bytes), and that both target zones exist in ZONES.
 */
export function parseIncentivePayload(raw: string): ScannedIncentive | null {
  if (!raw || raw.length > 500) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.v !== 1) {
    return null;
  }

  if (obj.type !== 'incentive') {
    return null;
  }

  if (
    typeof obj.from !== 'string' ||
    typeof obj.to !== 'string' ||
    typeof obj.reward !== 'string'
  ) {
    return null;
  }

  // Validate zones exist in venue
  const fromExists = ZONES.some((z) => z.id === obj.from);
  const toExists = ZONES.some((z) => z.id === obj.to);
  if (!fromExists || !toExists) {
    return null;
  }

  return {
    fromZone: obj.from,
    toZone: obj.to,
    reward: obj.reward,
  };
}

