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

/**
 * Validates the uploaded dataset payload against the MetLife Stadium graph rules,
 * enforcing value limits, property types, and zone/gate key validations.
 */
export function validateUploadDataset(rawText: string): ValidationResult {
  const errors: string[] = [];

  // 1. Strict Size Limit check
  const maxBytes = 200000;
  if (rawText.length > maxBytes) {
    return {
      valid: false,
      errors: [`Payload size exceeds limit of ${maxBytes / 1000}KB.`],
    };
  }

  // 2. JSON Parsing
  let parsed: any;
  try {
    parsed = JSON.parse(rawText);
  } catch (err: any) {
    return {
      valid: false,
      errors: [`Invalid JSON syntax: ${err.message || 'parse failed'}`],
    };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      valid: false,
      errors: ['Top-level payload must be a JSON object.'],
    };
  }

  // 3. Unknown Top-level Keys check
  const allowedKeys = new Set(['density', 'gateStatus', 'incidents']);
  const parsedKeys = Object.keys(parsed);
  for (const key of parsedKeys) {
    if (!allowedKeys.has(key)) {
      errors.push(`Unknown top-level property "${key}" found.`);
    }
  }

  // 4. Validate density
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

  // 5. Validate gateStatus
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

  // 6. Validate incidents
  if ('incidents' in parsed) {
    const incidentsVal = parsed.incidents;
    if (!Array.isArray(incidentsVal)) {
      errors.push("Property 'incidents' must be a JSON array.");
    } else {
      incidentsVal.forEach((inc: any, index: number) => {
        if (typeof inc !== 'object' || inc === null) {
          errors.push(`incidents[${index}]: must be a JSON object.`);
          return;
        }

        // Validate id
        if (typeof inc.id !== 'string' || !inc.id.trim()) {
          errors.push(`incidents[${index}].id: must be a non-empty string.`);
        }

        // Validate type
        if (!VALID_INCIDENT_TYPES.has(inc.type)) {
          errors.push(`incidents[${index}].type: must be one of crowd|medical|assistance|security|evacuation.`);
        }

        // Validate zoneId
        if (!VALID_ZONE_IDS.has(inc.zoneId)) {
          errors.push(`incidents[${index}].zoneId: zone ID does not exist in venue metadata.`);
        }

        // Validate note
        if (typeof inc.note !== 'string' || !inc.note.trim()) {
          errors.push(`incidents[${index}].note: must be a non-empty string.`);
        }

        // Validate status
        if (!VALID_INCIDENT_STATUSES.has(inc.status)) {
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
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    errors: [],
    data: parsed as UploadDataset,
  };
}
