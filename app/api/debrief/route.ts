import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/ai/client';
import { parseLlmJson } from '@/lib/ai/parseLlmJson';
import { simSnapshotSchema } from '@/lib/validation/simSnapshot';
import { allowRequest } from '@/lib/server/rateLimit';
import { readJsonBody } from '@/lib/server/readJsonBody';
import { aggregateDebriefData, DebriefInput } from '@/lib/engine/debriefData';
import { matchPhase } from '@/lib/simulation/engine';
import { EDGES } from '@/lib/venue/venue';
import type { SimState } from '@/lib/types';

// Same server-side-key pattern and input-validation/defense-in-depth as
// /api/copilot, even though this route takes no free-text user input.
// Hard body cap, enforced while streaming — the debrief reads the full
// timeline history, same budget as /api/copilot.
const BODY_MAX_BYTES = 2 * 1024 * 1024;

const requestSchema = z.object({
  sequencerPhase: z.string().max(40).nullable().optional(),
  simSnapshot: simSnapshotSchema,
}).strict();

function buildFallbackReport(data: DebriefInput): string {
  const lines: string[] = ['## Summary', 'Post-event debrief compiled from session data (AI narrative unavailable).', ''];

  lines.push('## Top Bottlenecks');
  if (data.topBottlenecks.length === 0) {
    lines.push('No significant bottlenecks recorded this session.');
  } else {
    for (const b of data.topBottlenecks) {
      const cause = b.rootCause.chain[b.rootCause.chain.length - 1];
      lines.push(`- ${b.zoneId}: peaked at ${Math.round(b.peakDensity * 100)}% density. Cause: ${cause?.label ?? 'unknown'}.`);
    }
  }
  lines.push('');

  lines.push('## Incident Response');
  if (data.incidentStats.length === 0) {
    lines.push('No resolved incidents recorded this session.');
  } else {
    const avg = Math.round(
      data.incidentStats.reduce((sum, i) => sum + i.responseSec, 0) / data.incidentStats.length
    );
    lines.push(`- ${data.incidentStats.length} incident(s) resolved, average response time ${avg}s.`);
    const breached = data.incidentStats.filter((i) => i.breached);
    lines.push(
      breached.length > 0
        ? `- Near-miss: ${breached.length} incident(s) breached the SLA response window.`
        : '- No SLA breaches recorded.'
    );
  }

  return lines.join('\n');
}

export async function POST(req: Request) {
  if (!allowRequest('debrief', req)) {
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

  const validated = result.data;

  const isFullTime = validated.sequencerPhase
    ? (validated.sequencerPhase === 'post' || validated.sequencerPhase === 'idle')
    : (matchPhase(validated.simSnapshot.matchClockSec) === 'fullTime');

  if (!isFullTime) {
    return NextResponse.json(
      { error: 'Debrief is only available once the match has reached full-time' },
      { status: 400 }
    );
  }

  const state: SimState = {
    matchClockSec: validated.simSnapshot.matchClockSec,
    density: validated.simSnapshot.density,
    gateStatus: validated.simSnapshot.gateStatus,
    incidents: validated.simSnapshot.incidents,
    routedLoad: validated.simSnapshot.routedLoad,
    sensorCounts: validated.simSnapshot.sensorCounts,
    timeline: validated.simSnapshot.timeline || [],
  };

  const debriefData = aggregateDebriefData(state, EDGES);

  const systemPrompt =
    'You are the StadiumIQ AI Ops Assistant for MetLife Stadium, generating a one-shot post-event debrief report.\n' +
    'Using ONLY the grounding data provided (never invent numbers), write a structured report covering:\n' +
    '1. A brief summary paragraph of the session.\n' +
    '2. The top bottlenecks: for each, its peak density, its real root-cause chain, and a concrete suggestion for what would have prevented it.\n' +
    '3. Incident response-time statistics (count, average response time in seconds).\n' +
    '4. Near-miss callouts: incidents whose response time breached the SLA window.\n' +
    'Respond ONLY with a raw JSON object: {"report": string}. The report string may use "## Header" lines for sections and "- " for list items. Do not wrap in markdown code fences.';

  const userPrompt = `<debrief_data>\n${JSON.stringify(debriefData)}\n</debrief_data>`;

  try {
    const client = createClient();
    const chatResult = await client.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      []
    );

    const parsed = parseLlmJson(chatResult.text) as { report?: unknown };
    if (!parsed.report || typeof parsed.report !== 'string') {
      throw new Error('Malformed JSON structure');
    }

    return NextResponse.json({ report: parsed.report });
  } catch (err) {
    console.error('API debrief error:', err);
    // Safe fallback: a deterministic report built entirely from real aggregated data.
    return NextResponse.json({ report: buildFallbackReport(debriefData) });
  }
}
