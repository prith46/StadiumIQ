import { z } from 'zod';

/**
 * lib/validation/simSnapshot.ts
 *
 * Shared request-body schemas for the sim snapshot that the browser posts to
 * every AI route (/api/assistant, /api/copilot, /api/debrief). Previously each
 * route declared its own copy with `incidents: z.array(z.any())` and
 * `timeline: z.array(z.any())` — letting arbitrarily shaped/sized nested
 * payloads flow into tool context and prompt-grounding data. These schemas
 * type both fully and cap array sizes.
 */

const gateStatusValue = z.enum(['open', 'congested', 'closed']);

/** Mirrors lib/types.ts Incident. Unknown keys are stripped by zod. */
export const incidentSchema = z.object({
  id: z.string().max(120),
  type: z.enum(['crowd', 'medical', 'assistance', 'security', 'evacuation']),
  zoneId: z.string().max(120),
  // Fan-authored free text — length-capped here; prompt-injection delimiters
  // are stripped by sanitizeUserInput at the point it enters a prompt.
  note: z.string().max(2000),
  status: z.enum(['pending', 'dispatched', 'resolved']),
  createdAt: z.number(),
  responderId: z.string().max(120).optional(),
  etaSec: z.number().optional(),
});

/** Mirrors lib/types.ts DensityFrame. */
export const densityFrameSchema = z.object({
  atSec: z.number(),
  density: z.record(z.string(), z.number()),
  gateStatus: z.record(z.string(), gateStatusValue),
});

export const simSnapshotSchema = z.object({
  matchClockSec: z.number(),
  density: z.record(z.string(), z.number()),
  gateStatus: z.record(z.string(), gateStatusValue),
  incidents: z.array(incidentSchema).max(200),
  routedLoad: z.record(z.string(), z.number()),
  sensorCounts: z.record(z.string(), z.number()),
  // The precomputed forecast timeline is one frame per TIMELINE_FRAME_STEP_SEC
  // across the whole match — well under this cap; anything bigger is abuse.
  timeline: z.array(densityFrameSchema).max(1000).optional(),
});
