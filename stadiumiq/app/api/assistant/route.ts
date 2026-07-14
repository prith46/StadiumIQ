import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runFanAssistant, FALLBACK_RESPONSE } from '@/lib/ai/agents';
import type { ToolContext } from '@/lib/ai/tools';
import { ZONES } from '@/lib/venue/venue';
import { simSnapshotSchema } from '@/lib/validation/simSnapshot';
import { fanContextSchema } from '@/lib/validation/fanContext';
import { allowRequest } from '@/lib/server/rateLimit';
import { readJsonBody } from '@/lib/server/readJsonBody';

// Server-side cap on prior turns forwarded to the model (token efficiency).
const HISTORY_MAX_TURNS = 8;

// Hard body cap, enforced while streaming (before any parse/validation work).
// The largest legitimate payload is the trimmed forecast timeline — well
// under this.
const BODY_MAX_BYTES = 1024 * 1024;

const requestSchema = z.object({
  message: z.string().max(2000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().max(2000),
  })).max(20).optional(),
  fanContext: fanContextSchema,
  simSnapshot: simSnapshotSchema,
  // The fan's live incentives — sent by the browser because the server
  // process has no access to the client's Zustand stores.
  activeIncentives: z.array(z.object({
    id: z.string().max(120),
    fromZone: z.string().max(120),
    toZone: z.string().max(120),
    reward: z.string().max(300),
    qrPayload: z.string().max(500),
    expiresAt: z.number(),
  })).max(20).optional(),
}).strict();

export async function POST(req: Request) {
  if (!allowRequest('assistant', req)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const read = await readJsonBody(req, BODY_MAX_BYTES);
  if (!read.ok) {
    return read.reason === 'too_large'
      ? NextResponse.json({ error: 'Payload too large' }, { status: 413 })
      : NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
  }
  const body: unknown = read.body;

  const result = requestSchema.safeParse(body);
  if (!result.success) {
    // Never surface raw zod error internals to the client (§8).
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const validated = result.data;
  const ctx: ToolContext = {
    simSnapshot: {
      ...validated.simSnapshot,
      timeline: validated.simSnapshot.timeline || [],
    },
    zones: ZONES,
    fanContext: validated.fanContext,
    activeIncentives: validated.activeIncentives,
  };

  try {
    const history = (validated.history || []).slice(-HISTORY_MAX_TURNS);
    const response = await runFanAssistant(validated.message, validated.fanContext, ctx, history);
    return NextResponse.json(response);
  } catch (err) {
    console.error('API assistant error:', err);
    return NextResponse.json({
      ...FALLBACK_RESPONSE,
      language: validated.fanContext.language || 'en',
    });
  }
}
