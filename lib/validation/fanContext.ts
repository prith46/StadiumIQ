import { z } from 'zod';

/**
 * lib/validation/fanContext.ts
 *
 * Shared request-body schema for the fan context the browser posts to
 * /api/assistant and /api/vision. Every string field is length-capped:
 * several of them (location, ticket section/gate/nationality) are
 * interpolated into a system-role LLM prompt server-side, so unbounded
 * client strings are both a token-cost and a prompt-injection surface.
 * Previously each route declared its own uncapped copy.
 */
export const fanContextSchema = z.object({
  // BCP-47 language tags are at most 35 characters.
  language: z.string().max(35),
  accessibility: z.boolean(),
  // Zone ids are short; 120 matches the incident zoneId cap in simSnapshot.ts.
  location: z.string().max(120).optional(),
  group: z.enum(['solo', 'family', 'group']).optional(),
  leavingEarly: z.boolean().optional(),
  sensory: z.object({
    quiet: z.boolean().optional(),
    openAir: z.boolean().optional(),
    avoidAffiliation: z.enum(['home', 'away']).optional(),
  }).optional(),
  ticket: z.object({
    section: z.string().max(40),
    gate: z.string().max(40),
    nationality: z.string().max(80),
    countryCode: z.string().max(8),
    seat: z.string().max(40).optional(),
  }).optional(),
});
