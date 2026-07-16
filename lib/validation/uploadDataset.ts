import { ZONES } from '../venue/venue';
import { UploadDataset } from '../types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  data?: UploadDataset;
}

const VALID_ZONE_IDS = new Set(ZONES.map((z) => z.id));
const VALID_GATE_IDS = new Set(ZONES.filter((z) => z.type === 'gate').map((z) => z.id));
const VALID_INCIDENT_TYPES = new Set(['crowd', 'medical', 'assistance', 'security', 'evacuation']);
const VALID_INCIDENT_STATUSES = new Set(['pending', 'dispatched', 'resolved']);

/** Maximum accepted upload payload size, in characters of JSON text. */
export const UPLOAD_MAX_CHARS = 200000;

/**
 * Validates an ALREADY-PARSED upload payload object against the MetLife
 * Stadium graph rules (value ranges, property types, zone/gate key checks).
 *
 * Single source of truth for upload-dataset shape validation: both the
 * UploadPanel (raw file text, via validateUploadDataset below) and the
 * simStore's importDataset action (parsed objects, e.g. re-broadcast over the
 * sim channel) delegate here, so the rules can never drift apart.
 */
export function validateUploadDatasetObject(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      valid: false,
      errors: ['Top-level payload must be a JSON object.'],
    };
  }

  const parsed = input as Record<string, unknown>;

  // Unknown top-level keys check
  const allowedKeys = new Set(['density', 'gateStatus', 'incidents']);
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unknown top-level property "${key}" found.`);
    }
  }

  // Validate density
  if ('density' in parsed) {
    const densityVal = parsed.density;
    if (typeof densityVal !== 'object' || densityVal === null || Array.isArray(densityVal)) {
      errors.push("Property 'density' must be a JSON object map.");
    } else {
      for (const [zoneId, val] of Object.entries(densityVal)) {
        // Validate zone ID exists
        if (!VALID_ZONE_IDS.has(zoneId)) {
          errors.push(`density['${zoneId}']: zone ID does not exist in venue metadata.`);
        }
        // Validate density value is a number in [0, 1]
        if (typeof val !== 'number' || isNaN(val) || val < 0 || val > 1) {
          errors.push(`density['${zoneId}']: value must be a number between 0 and 1.`);
        }
      }
    }
  }

  // Validate gateStatus
  if ('gateStatus' in parsed) {
    const gateStatusVal = parsed.gateStatus;
    if (typeof gateStatusVal !== 'object' || gateStatusVal === null || Array.isArray(gateStatusVal)) {
      errors.push("Property 'gateStatus' must be a JSON object map.");
    } else {
      for (const [gateId, status] of Object.entries(gateStatusVal)) {
        // Validate gate ID exists and is a gate
        if (!VALID_GATE_IDS.has(gateId)) {
          errors.push(`gateStatus['${gateId}']: gate ID does not exist or zone is not a gate.`);
        }
        // Validate status value
        if (status !== 'open' && status !== 'congested' && status !== 'closed') {
          errors.push(`gateStatus['${gateId}']: status must be 'open', 'congested', or 'closed'.`);
        }
      }
    }
  }

  // Validate incidents
  if ('incidents' in parsed) {
    const incidentsVal = parsed.incidents;
    if (!Array.isArray(incidentsVal)) {
      errors.push("Property 'incidents' must be a JSON array.");
    } else {
      incidentsVal.forEach((entry: unknown, index: number) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          errors.push(`incidents[${index}]: must be a JSON object.`);
          return;
        }
        const inc = entry as Record<string, unknown>;

        // Validate id
        if (typeof inc.id !== 'string' || !inc.id.trim()) {
          errors.push(`incidents[${index}].id: must be a non-empty string.`);
        }

        // Validate type
        if (typeof inc.type !== 'string' || !VALID_INCIDENT_TYPES.has(inc.type)) {
          errors.push(`incidents[${index}].type: must be one of crowd|medical|assistance|security|evacuation.`);
        }

        // Validate zoneId
        if (typeof inc.zoneId !== 'string' || !VALID_ZONE_IDS.has(inc.zoneId)) {
          errors.push(`incidents[${index}].zoneId: zone ID does not exist in venue metadata.`);
        }

        // Validate note
        if (typeof inc.note !== 'string' || !inc.note.trim()) {
          errors.push(`incidents[${index}].note: must be a non-empty string.`);
        }

        // Validate status
        if (typeof inc.status !== 'string' || !VALID_INCIDENT_STATUSES.has(inc.status)) {
          errors.push(`incidents[${index}].status: must be one of pending|dispatched|resolved.`);
        }

        // Validate createdAt
        if (typeof inc.createdAt !== 'number' || isNaN(inc.createdAt) || inc.createdAt < 0) {
          errors.push(`incidents[${index}].createdAt: must be a non-negative number.`);
        }

        // Optional responderId
        if (inc.responderId !== undefined && typeof inc.responderId !== 'string') {
          errors.push(`incidents[${index}].responderId: must be a string.`);
        }

        // Optional etaSec
        if (inc.etaSec !== undefined && (typeof inc.etaSec !== 'number' || isNaN(inc.etaSec) || inc.etaSec < 0)) {
          errors.push(`incidents[${index}].etaSec: must be a non-negative number.`);
        }
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    data: parsed as UploadDataset,
  };
}

/**
 * Validates a raw upload payload string: size cap, JSON parse, then the
 * shared object validation above.
 */
export function validateUploadDataset(rawText: string): ValidationResult {
  // 1. Strict size limit check — before any parsing work
  if (rawText.length > UPLOAD_MAX_CHARS) {
    return {
      valid: false,
      errors: [`Payload size exceeds limit of ${UPLOAD_MAX_CHARS / 1000}KB.`],
    };
  }

  // 2. JSON parsing
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    return {
      valid: false,
      errors: [`Invalid JSON syntax: ${err instanceof Error ? err.message : 'parse failed'}`],
    };
  }

  // 3. Shared object validation
  return validateUploadDatasetObject(parsed);
}
