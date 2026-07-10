import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runOrganizerCopilot, FALLBACK_RESPONSE } from '@/lib/ai/agents';
import { ZONES } from '@/lib/venue/venue';

const requestSchema = z.object({
  query: z.string().max(2000),
  simSnapshot: z.object({
    matchClockSec: z.number(),
    density: z.record(z.string(), z.number()),
    gateStatus: z.record(z.string(), z.enum(['open', 'congested', 'closed'])),
    incidents: z.array(z.any()),
    routedLoad: z.record(z.string(), z.number()),
    sensorCounts: z.record(z.string(), z.number()),
    timeline: z.array(z.any()).optional(),
  }),
}).strict();

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const result = requestSchema.safeParse(body);
  if (!result.success) {
    // Never surface raw zod error internals to the client (§8).
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const validated = result.data;
  const ctx = {
    simSnapshot: {
      ...validated.simSnapshot,
      timeline: validated.simSnapshot.timeline || [],
    },
    zones: ZONES,
  } as any;

  try {
    const response = await runOrganizerCopilot(validated.query, ctx);
    return NextResponse.json(response);
  } catch (err) {
    console.error('API copilot error:', err);
    return NextResponse.json({
      ...FALLBACK_RESPONSE,
      language: 'en',
    });
  }
}
