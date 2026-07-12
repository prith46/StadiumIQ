import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCopilotBrief, getForecastBrief } from '@/lib/ai/copilot';
import { recommendPrepositioning } from '@/lib/engine/staffPrepositioning';
import { traceRootCause } from '@/lib/engine/rootCause';
import { computeConfidenceBand } from '@/lib/engine/forecastConfidence';
import { RESPONDERS } from '@/lib/venue/responders';
import { EDGES } from '@/lib/venue/venue';

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
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }

  const validated = result.data;

  try {
    if (validated.type === 'forecast') {
      const response = await getForecastBrief({
        timeline: validated.simSnapshot.timeline || [],
        matchClockSec: validated.simSnapshot.matchClockSec,
      });

      // M24: extend (don't restructure) the forecast response with a concrete
      // staff pre-positioning recommendation for the top predicted hotspot.
      const topHotspot = 'topZones' in response ? response.topZones?.[0] : undefined;
      let prepositioning: ReturnType<typeof recommendPrepositioning> = [];
      if (topHotspot && 'peakAtSec' in response) {
        const committedResponderIds = new Set(
          (validated.simSnapshot.incidents || [])
            .filter((inc: any) => inc.status !== 'resolved' && inc.responderId)
            .map((inc: any) => inc.responderId)
        );
        const candidateResponders = RESPONDERS.map((r) => ({
          ...r,
          available: r.available && !committedResponderIds.has(r.id),
        }));
        prepositioning = recommendPrepositioning(
          { zoneId: topHotspot.zoneId, predictedCrossingSec: response.peakAtSec },
          candidateResponders,
          EDGES
        );
      }

      // M26: extend (don't restructure) each top zone with a confidence band
      // around its point prediction — wraps forecast.ts's output, doesn't
      // alter its prediction logic.
      const timeline = validated.simSnapshot.timeline || [];
      const topZonesWithConfidence = 'topZones' in response
        ? (response.topZones || []).map((zone) => ({
            ...zone,
            confidenceBand: 'peakAtSec' in response
              ? computeConfidenceBand({ density: zone.density, crossingSec: response.peakAtSec }, timeline, zone.zoneId)
              : undefined,
          }))
        : undefined;

      return NextResponse.json({
        ...response,
        prepositioning,
        ...(topZonesWithConfidence ? { topZones: topZonesWithConfidence } : {}),
      });
    } else {
      const response = await getCopilotBrief({
        query: validated.query || 'what are my biggest risks now?',
        incidents: validated.simSnapshot.incidents,
        density: validated.simSnapshot.density,
        gateStatus: validated.simSnapshot.gateStatus,
      });

      // M25: extend (don't restructure) the risk-brief response with a
      // backward-traced root-cause chain for each risk that names a zone,
      // reusing the same frame history + adjacency logic M23's cascade
      // prediction reads forward (no new history storage).
      if ('topRisks' in response && Array.isArray(response.topRisks)) {
        const history = validated.simSnapshot.timeline || [];
        const topRisksWithCause = response.topRisks.map((risk) => {
          if (!risk.zoneId) return risk;
          const rootCause = traceRootCause(
            risk.zoneId,
            history,
            validated.simSnapshot.gateStatus,
            validated.simSnapshot.incidents,
            EDGES
          );
          return { ...risk, rootCause };
        });
        return NextResponse.json({ ...response, topRisks: topRisksWithCause });
      }

      return NextResponse.json(response);
    }
  } catch (err) {
    console.error('API copilot error:', err);
    return NextResponse.json({ error: 'Copilot request failed' }, { status: 500 });
  }
}
