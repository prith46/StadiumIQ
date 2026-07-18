import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateIncidentReport } from '@/lib/ai/incidentReport';
import { guardRequest } from '@/lib/server/guardRequest';

// Hard body cap, enforced while streaming — this route carries one incident
// plus one assignment, so the budget is small.
const BODY_MAX_BYTES = 64 * 1024;

// M17: the AI post-incident report must run server-side — the LLM client
// reads LLM_* env vars that (correctly) never reach the browser bundle.
// Same server-side-key pattern and validation approach as /api/debrief.
// String caps mirror lib/validation/simSnapshot.ts's incidentSchema — these
// fields are interpolated into the report prompt.
const requestSchema = z.object({
  incident: z.object({
    id: z.string().max(120),
    type: z.enum(['crowd', 'medical', 'assistance', 'security', 'evacuation']),
    zoneId: z.string().max(120),
    note: z.string().max(2000),
    status: z.enum(['pending', 'dispatched', 'resolved']),
    createdAt: z.number(),
    responderId: z.string().max(120).optional(),
    etaSec: z.number().optional(),
  }),
  assignment: z.object({
    incidentId: z.string().max(120),
    responderId: z.string().max(120).nullable(),
    etaSec: z.number().nullable(),
    predictedBreach: z.boolean(),
  }),
}).strict();

export async function POST(req: Request) {
  const guard = await guardRequest(req, { route: 'incident-report', maxBytes: BODY_MAX_BYTES, schema: requestSchema });
  if (!guard.ok) return guard.response;

  const { incident, assignment } = guard.data;

  // generateIncidentReport sanitizes the note and already degrades to a
  // deterministic summary string on LLM failure — no extra fallback needed.
  const report = await generateIncidentReport(incident, assignment);
  return NextResponse.json({ report });
}
