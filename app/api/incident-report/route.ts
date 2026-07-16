import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateIncidentReport } from '@/lib/ai/incidentReport';
import { allowRequest } from '@/lib/server/rateLimit';
import { readJsonBody } from '@/lib/server/readJsonBody';

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
  if (!allowRequest('incident-report', req)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const read = await readJsonBody(req, BODY_MAX_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Payload too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const result = requestSchema.safeParse(read.body);
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const { incident, assignment } = result.data;

  // generateIncidentReport sanitizes the note and already degrades to a
  // deterministic summary string on LLM failure — no extra fallback needed.
  const report = await generateIncidentReport(incident, assignment);
  return NextResponse.json({ report });
}
