import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCopilotBrief, getForecastBrief } from '@/lib/ai/copilot';

const requestSchema = z.object({
  type: z.enum(['brief', 'forecast']).default('brief'),
  query: z.string().max(2000).optional(),
  simSnapshot: z.object({
    matchClockSec: z.number(),
    density: z.record(z.string(), z.number()),
    gateStatus: z.record(z.string(), z.enum(['open', 'congested', 'closed'])),
    incidents: z.array(z.any()),
    routedLoad: z.record(z.string(), z.number()),
    sensorCounts: z.record(z.string(), z.number()),
    timeline: z.array(z.any()).optional(),
  }),
});

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const result = requestSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const validated = result.data;

  try {
    if (validated.type === 'forecast') {
      const response = await getForecastBrief({
        timeline: validated.simSnapshot.timeline || [],
        matchClockSec: validated.simSnapshot.matchClockSec,
      });
      return NextResponse.json(response);
    } else {
      const response = await getCopilotBrief({
        query: validated.query || 'what are my biggest risks now?',
        incidents: validated.simSnapshot.incidents,
        density: validated.simSnapshot.density,
        gateStatus: validated.simSnapshot.gateStatus,
      });
      return NextResponse.json(response);
    }
  } catch (err) {
    console.error('API copilot error:', err);
    return NextResponse.json({ error: 'Copilot request failed' }, { status: 500 });
  }
}
