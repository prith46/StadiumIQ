import { createClient, ChatMessage } from './client';
import { Incident, DensityFrame } from '../types';
import { findPeakCrush, forecastAt } from '../engine/forecast';
import { sanitizeUserInput } from './sanitize';
import { parseLlmJson } from './parseLlmJson';

export interface CopilotQueryInput {
  query: string;
  incidents: Incident[];
  density: Record<string, number>;
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
}

export interface CopilotBrief {
  summary: string;
  topRisks: Array<{ description: string; zoneId?: string; priority: 1 | 2 | 3 }>;
  recommendedActions: string[];
}

export interface ForecastBriefInput {
  timeline: DensityFrame[];
  matchClockSec: number;
}

export interface ForecastBrief {
  peakAtSec: number;
  topZones: Array<{ zoneId: string; density: number }>;
  narrative: string;
  staffingRecommendation: string;
}

/**
 * Generates an operational risk brief based on real-time incidents, density, and gates.
 * Sanitizes user query text against prompt tag injections.
 */
export async function getCopilotBrief(
  input: CopilotQueryInput
): Promise<CopilotBrief | { error: string }> {
  // 1. Injection Defense: Sanitize user query against all prompt-block delimiters
  const sanitizedQuery = sanitizeUserInput(input.query);

  // 2. Token-Efficiency: Summarize incidents and high-density zones
  const activeIncidents = input.incidents
    .filter((inc) => inc.status !== 'resolved')
    .map((inc) => ({
      id: inc.id,
      type: inc.type,
      zone: inc.zoneId,
      // Incident notes are fan-authored free text — strip prompt-block
      // delimiters so a note can't break out of <stadium_snapshot>.
      note: sanitizeUserInput(inc.note),
      status: inc.status,
    }))
    .slice(0, 10); // cap at 10 active incidents

  const hotZones = Object.entries(input.density)
    .filter(([, density]) => density >= 0.5)
    .map(([zoneId, density]) => ({ zoneId, density }))
    .sort((a, b) => b.density - a.density)
    .slice(0, 5); // top 5 hot zones

  const gateSummaries = Object.entries(input.gateStatus).map(([gateId, status]) => ({
    gateId,
    status,
  }));

  const systemPrompt =
    'You are the StadiumIQ AI Ops Assistant (Copilot) for MetLife Stadium.\n' +
    'Evaluate the provided stadium snapshot and user query. ' +
    'You must respond ONLY with a raw JSON object containing three fields:\n' +
    '1. "summary" (string): brief paragraph overview of the stadium situation.\n' +
    '2. "topRisks" (array of objects): each has "description" (string), "zoneId" (string, optional), and "priority" (number: 1, 2, or 3, where 1 is highest priority).\n' +
    '3. "recommendedActions" (array of strings): list of recommended operator steps.\n' +
    'Do not wrap the JSON output in markdown formatting (like ```json). Just return raw JSON.';

  const userPrompt =
    `<stadium_snapshot>\n` +
    `Active Incidents: ${JSON.stringify(activeIncidents)}\n` +
    `High-Density Seating/Gates: ${JSON.stringify(hotZones)}\n` +
    `Gate Statuses: ${JSON.stringify(gateSummaries)}\n` +
    `</stadium_snapshot>\n\n` +
    `<user_query>\n` +
    `${sanitizedQuery}\n` +
    `</user_query>`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const client = createClient();
    const result = await client.chat(messages, []);

    // Field-level validation of the model's JSON: salvage well-formed risk
    // entries, drop malformed ones, and clamp priority to the 1|2|3 contract
    // instead of trusting the cast.
    const parsed = parseLlmJson(result.text) as Partial<CopilotBrief>;
    if (
      typeof parsed.summary !== 'string' || !parsed.summary ||
      !Array.isArray(parsed.topRisks) ||
      !Array.isArray(parsed.recommendedActions) ||
      !parsed.recommendedActions.every((a) => typeof a === 'string')
    ) {
      throw new Error('Malformed JSON structure');
    }

    const topRisks: CopilotBrief['topRisks'] = [];
    for (const item of parsed.topRisks as unknown[]) {
      if (!item || typeof item !== 'object') continue;
      const risk = item as { description?: unknown; zoneId?: unknown; priority?: unknown };
      if (typeof risk.description !== 'string') continue;
      topRisks.push({
        description: risk.description,
        zoneId: typeof risk.zoneId === 'string' ? risk.zoneId : undefined,
        priority: risk.priority === 1 || risk.priority === 3 ? risk.priority : 2,
      });
    }

    return { summary: parsed.summary, topRisks, recommendedActions: parsed.recommendedActions };
  } catch {
    // Resilient fallback brief, built deterministically from the real
    // incident summary — and honest about being a fallback.
    return {
      summary:
        'Live AI brief unavailable — this is a deterministic fallback compiled from current incident data.',
      topRisks: activeIncidents.map((inc) => ({
        description: `Unresolved incident reported: ${inc.note}`,
        zoneId: inc.zone,
        priority: inc.type === 'medical' || inc.type === 'evacuation' ? 1 : 2,
      })),
      recommendedActions: [
        'Dispatch emergency services or nearest responder to pending incidents.',
        'Monitor crowd flows around gate entrances.',
      ],
    };
  }
}

/**
 * Computes a 15-minute predictive forecast using findPeakCrush and forecastAt.
 * Delegates the narrative explanation of these exact numbers to the LLM.
 */
export async function getForecastBrief(
  input: ForecastBriefInput
): Promise<ForecastBrief | { error: string }> {
  // 1. Deterministic calculation: Peak crush within the next 15 minutes (900 seconds)
  const peakResult = findPeakCrush(input.timeline, input.matchClockSec, 900);
  const peakAtSec = peakResult.peakAtSec ?? input.matchClockSec;
  const topZones = peakResult.topZones ?? [];

  // 2. Deterministic calculation: Specific densities at exactly 15 minutes lookahead
  const forecastResult = forecastAt(input.timeline, input.matchClockSec, 900);
  const hotZonesAtForecast = Object.entries(forecastResult.density || {})
    .filter(([, density]) => density >= 0.5)
    .map(([zoneId, density]) => ({ zoneId, density }));

  const systemPrompt =
    'You are the StadiumIQ AI Ops Assistant (Copilot) for MetLife Stadium.\n' +
    'Your task is to write a brief explanation of a pre-calculated crowd forecast snapshot.\n' +
    'CRITICAL: You are strictly forbidden from inventing or changing any numbers. Use only the provided peak times and densities.\n' +
    'Respond ONLY with a raw JSON object containing:\n' +
    '1. "narrative" (string): A short, professional paragraph explaining when the peak crush occurs and which zones are affected.\n' +
    '2. "staffingRecommendation" (string): Operational recommendation for crew allocation based strictly on these hot zones.\n' +
    'Do not wrap the JSON output in markdown formatting. Return raw JSON.';

  // Fix 8: when there's genuinely no significant predicted hotspot, tell the
  // LLM that explicitly via the grounding data instead of handing it an empty
  // array and a prompt that still says "explain which zones are affected" —
  // that contradiction is what produced "highest density areas will include:"
  // with nothing after it.
  const noSignificantForecast = topZones.length === 0 && hotZonesAtForecast.length === 0;

  const userPrompt =
    `<forecast_calculations>\n` +
    `Current Time: ${input.matchClockSec}s\n` +
    `Predicted Peak Time: ${peakAtSec}s (${Math.round((peakAtSec - input.matchClockSec) / 60)} minutes from now)\n` +
    `Peak Top High-Density Zones: ${JSON.stringify(topZones)}\n` +
    `Densities at +15 mins lookahead: ${JSON.stringify(hotZonesAtForecast)}\n` +
    `noSignificantForecast: ${noSignificantForecast}\n` +
    (noSignificantForecast
      ? `Note: there is no significant predicted hotspot in this window — say so plainly, don't describe hot zones that don't exist.\n`
      : '') +
    `</forecast_calculations>`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  try {
    const client = createClient();
    const result = await client.chat(messages, []);

    const parsed = parseLlmJson(result.text) as { narrative?: string; staffingRecommendation?: string };
    if (!parsed.narrative || !parsed.staffingRecommendation) {
      throw new Error('Malformed JSON structure');
    }

    return {
      peakAtSec,
      topZones,
      narrative: parsed.narrative,
      staffingRecommendation: parsed.staffingRecommendation,
    };
  } catch {
    // Resilient fallback forecast brief
    // Fix 7: `secs % 60` on a non-integer `peakAtSec` (e.g. an interpolated
    // timeline timestamp) produced raw floats like "01:0.9990000000000023" —
    // both the minutes and seconds components must be floored.
    const formatTime = (secs: number) => {
      const wholeSecs = Math.floor(secs);
      const m = Math.floor(wholeSecs / 60);
      const s = wholeSecs % 60;
      return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    };

    return {
      peakAtSec,
      topZones,
      narrative: noSignificantForecast
        ? `No significant hotspots predicted in the next 15 minutes — crowd density remains within normal operating range through match clock ${formatTime(peakAtSec)}.`
        : `Deterministic peak density is predicted at match clock ${formatTime(peakAtSec)}. Highest density areas will include: ${topZones.map((z) => `${z.zoneId} (${Math.round(z.density * 100)}%)`).join(', ')}.`,
      staffingRecommendation: noSignificantForecast
        ? 'No elevated staffing action required at this time — maintain standard coverage.'
        : 'Deploy standby dispatch teams and open alternative routes near congestion zones.',
    };
  }
}
