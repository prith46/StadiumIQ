import { NextResponse } from 'next/server';
import { z } from 'zod';
import { runFanAssistant, FALLBACK_RESPONSE } from '@/lib/ai/agents';
import type { ToolContext } from '@/lib/ai/tools';
import { ZONES } from '@/lib/venue/venue';
import { simSnapshotSchema } from '@/lib/validation/simSnapshot';
import { fanContextSchema } from '@/lib/validation/fanContext';
import { guardRequest } from '@/lib/server/guardRequest';

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
  const guard = await guardRequest(req, { route: 'assistant', maxBytes: BODY_MAX_BYTES, schema: requestSchema });
  if (!guard.ok) return guard.response;

  const validated = guard.data;
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
