import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCopilotBrief, getForecastBrief } from '@/lib/ai/copilot';
import { recommendPrepositioning } from '@/lib/engine/staffPrepositioning';
import { traceRootCause } from '@/lib/engine/rootCause';
import { computeConfidenceBand } from '@/lib/engine/forecastConfidence';
import { RESPONDERS } from '@/lib/venue/responders';
import { EDGES } from '@/lib/venue/venue';
import { simSnapshotSchema } from '@/lib/validation/simSnapshot';
import { allowRequest } from '@/lib/server/rateLimit';
import { readJsonBody } from '@/lib/server/readJsonBody';

// Hard body cap, enforced while streaming. The copilot intentionally receives
// the FULL forecast timeline (root-cause tracing reads history), so this cap
// is higher than the assistant route's.
const BODY_MAX_BYTES = 2 * 1024 * 1024;

const requestSchema = z.object({
  type: z.enum(['brief', 'forecast']).default('brief'),
  query: z.string().max(2000).optional(),
  simSnapshot: simSnapshotSchema,
}).strict();

export async function POST(req: Request) {
  if (!allowRequest('copilot', req)) {
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
            .filter((inc) => inc.status !== 'resolved' && inc.responderId)
            .map((inc) => inc.responderId)
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
