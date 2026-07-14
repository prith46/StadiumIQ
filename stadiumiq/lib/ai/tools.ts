import { Zone, SimState, FanContext, Incentive, Incident } from '../types';
import { POIS, ZONES, EDGES, getEdgesFrom } from '../venue/venue';
import { computeRoute as engineComputeRoute, RouteFilters } from '../engine/routing';
import { resolveDestination, DestinationQuery } from '../engine/destinationResolver';
import { sensoryToRouteFilters } from '../engine/sensoryFilters';
import { prioritizeAccessibleFacilities } from '../engine/facilities';
import { retrieve } from './rag';
import { getForecast, getPeakCrush, ForecastSource } from '../engine/forecast';
import { computeBaseDensity } from '../simulation/engine';
import { detectStressHeuristic } from './stressDetection';
import { useIncentiveStore } from '../store/incentiveStore';
import { useSimStore } from '../store/simStore';

export class UnknownToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownToolError';
  }
}

export interface ToolContext {
  simSnapshot: SimState;
  zones: Zone[];
  fanContext?: FanContext;
  // The fan's live incentives, sent by the browser with each request. The API
  // route runs in a separate process from the browser's Zustand stores, so
  // server-side tools must read these from the request context, not the store.
  activeIncentives?: Incentive[];
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolDefinition {
  schema: ToolSchema;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown> | unknown;
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  computeRoute: {
    schema: {
      name: 'computeRoute',
      description:
        'Calculates the optimal, crowd-aware walking path and ETA between zones in the stadium. ' +
        'Accepts a destination zone id, a POI type (e.g. "restroom"), or "nearestExit". ' +
        'Returns path (ordered zone ids), etaSec, and a reason object naming any congested ' +
        'zones/gates that were avoided so the LLM can phrase the explanation accurately. ' +
        'avoidedGates is an array of objects: { gateId: string, cause: "congested" | "closed" }. ' +
        'IMPORTANT: whenever avoidedGates is non-empty, your reply MUST explain WHY this route/exit ' +
        'was chosen by explicitly naming those gates and their cause — e.g. "Gates A, C and D are ' +
        'closed, so I\'ve routed you to Gate B." Never omit closed/congested gate reasons from the message. ' +
        'Infer sensory filters from natural phrasing for a ONE-TIME request: "claustrophobic" ' +
        'or "keep me in open air" -> avoidEnclosed: true; "quietest way"/"sleeping toddler" -> ' +
        'maxNoise: "low"; "I\'m an away fan"/"avoid the home section" -> avoidAffiliation set to ' +
        'the section the fan wants to avoid. Only pass these explicitly when the fan is asking ' +
        'for THIS route specifically — if they say it should always apply, tell them to use the ' +
        'sensory preferences panel instead of relying on this one-time filter.',
      parameters: {
        type: 'object',
        properties: {
          originZoneId: {
            type: 'string',
            description:
              'Starting zone ID (preferred). Also accepts legacy alias fromZoneId. ' +
              'If omitted, falls back to fanContext.location from the store.',
          },
          fromZoneId: {
            type: 'string',
            description:
              'Legacy alias for originZoneId. Present for backward compatibility with ' +
              'pre-M3 callers that used the stub schema. New callers should use originZoneId.',
          },
          destination: {
            type: 'object',
            description: 'What to route to. One of: zone id, POI type, or nearest exit.',
            properties: {
              kind: {
                type: 'string',
                enum: ['zone', 'poiType', 'nearestExit'],
              },
              zoneId: { type: 'string', description: 'Zone id (when kind=zone), including transit nodes (transit-taxi, transit-bus, transit-train, transit-parking), gates (gate-a), and sections (sec-101)' },
              poiType: {
                type: 'string',
                description: 'POI type (when kind=poiType), e.g. restroom, food, first_aid',
              },
            },
            required: ['kind'],
          },
          filters: {
            type: 'object',
            description: 'Optional route filters.',
            properties: {
              accessibleOnly: {
                type: 'boolean',
                description: 'If true, exclude stairs-only (inaccessible) edges. Hard filter.',
              },
              avoidEnclosed: {
                type: 'boolean',
                description: 'Penalise enclosed passages (soft filter, 3× weight).',
              },
              maxNoise: {
                type: 'string',
                enum: ['low', 'med', 'high'],
                description: 'Penalise edges louder than this level (soft filter).',
              },
              avoidAffiliation: {
                type: 'string',
                enum: ['home', 'away'],
                description: 'Penalise zones of this crowd affiliation (soft filter).',
              },
            },
          },
        },
        // Support either new or legacy origin param
        required: [],
      },
    },
    execute: (args, ctx) => {
      // Resolve origin — prefer originZoneId, fall back to legacy fromZoneId
      const rawOrigin: string | undefined =
        (args.originZoneId as string | undefined) ??
        (args.fromZoneId as string | undefined) ??
        ctx.fanContext?.location;

      if (!rawOrigin) {
        return {
          error: 'invalid_zone_id',
          message: "I couldn't determine your current location. Please specify your zone.",
        };
      }

      // Validate origin against known zones (security: no hallucinated ids)
      const knownZoneIds = new Set(ZONES.map((z) => z.id));
      if (!knownZoneIds.has(rawOrigin)) {
        return {
          error: 'invalid_zone_id',
          message: `I couldn't find the zone "${rawOrigin}". Please check the zone ID.`,
        };
      }

      // Resolve destination query
      const rawDest = args.destination as Record<string, unknown> | undefined;
      let destinationQuery: DestinationQuery;

      if (!rawDest || rawDest.kind === 'nearestExit') {
        destinationQuery = { kind: 'nearestExit' };
      } else if (rawDest.kind === 'poiType') {
        destinationQuery = {
          kind: 'poiType',
          poiType: rawDest.poiType as DestinationQuery extends { kind: 'poiType' }
            ? DestinationQuery['poiType']
            : never,
        };
      } else {
        // kind === 'zone'
        const destZoneId = rawDest.zoneId as string | undefined;
        if (!destZoneId || !knownZoneIds.has(destZoneId)) {
          return {
            error: 'invalid_zone_id',
            message: destZoneId
              ? `I couldn't find the destination zone "${destZoneId}".`
              : 'No destination zone id provided.',
          };
        }
        destinationQuery = { kind: 'zone', zoneId: destZoneId };
      }

      // Extract live state from context snapshot
      const { density, routedLoad, gateStatus } = ctx.simSnapshot;

      // Build POI status map from live POIS
      const poiStatus: Record<string, 'open' | 'busy' | 'closed'> = {};
      for (const poi of POIS) poiStatus[poi.id] = poi.status;

      // Resolve destination to concrete zone id
      const resolvedZoneId = resolveDestination(
        destinationQuery,
        rawOrigin,
        EDGES,
        ZONES,
        POIS,
        poiStatus,
        gateStatus
      );

      if (typeof resolvedZoneId !== 'string') {
        return {
          error: resolvedZoneId.error,
          message:
            resolvedZoneId.error === 'no_matching_poi'
              ? "I couldn't find an open amenity of that type near you."
              : resolvedZoneId.error === 'no_open_exit'
              ? 'All exits are currently closed.'
              : "I couldn't find that location.",
        };
      }

      // Parse filters — a ONE-TIME LLM-explicit filter for this call takes
      // precedence per-field over the fan's persistent sensory defaults;
      // fields the LLM did not specify fall back to the persistent default.
      const rawFilters = args.filters as RouteFilters | undefined;
      const persistentSensory = sensoryToRouteFilters(ctx.fanContext?.sensory);
      const filters: RouteFilters = {
        accessibleOnly:
          rawFilters?.accessibleOnly ?? (ctx.fanContext?.accessibility || false),
        avoidEnclosed: rawFilters?.avoidEnclosed ?? persistentSensory.avoidEnclosed,
        maxNoise: rawFilters?.maxNoise ?? persistentSensory.maxNoise,
        avoidAffiliation: rawFilters?.avoidAffiliation ?? persistentSensory.avoidAffiliation,
      };

      // Call pure routing engine
      const result = engineComputeRoute(
        rawOrigin,
        resolvedZoneId,
        EDGES,
        ZONES,
        density,
        routedLoad,
        gateStatus,
        filters
      );

      if ('error' in result) {
        return {
          error: result.error,
          message:
            result.error === 'no_accessible_route_found'
              ? 'No accessible route found to that destination. You may need to use stairs.'
              : "I couldn't find a route to that destination.",
        };
      }

      // §6.3: increment routedLoad at the exit gate on the path. Best-effort:
      // the store only exists per-process, so this registers in same-process
      // (test) environments; in the deployed route handler the client's own
      // routedLoad accounting via routingService remains the source of truth.
      const exitZone = [...result.path].reverse().find((id: string) => id.startsWith('gate-'));
      if (exitZone) {
        useSimStore.getState().incrementRoutedLoad(exitZone);
      }

      return result;
    },
  },
  findAmenity: {
    schema: {
      name: 'findAmenity',
      description: 'Finds and ranks the closest points of interest (POIs) by walking distance.',
      parameters: {
        type: 'object',
        properties: {
          fromZoneId: { type: 'string', description: 'Starting zone ID' },
          type: { type: 'string', description: 'POI type (e.g. restroom, food, first_aid, water, merch)' },
          nearestOpen: { type: 'boolean', description: 'Filter only open/busy assets' },
        },
        required: ['fromZoneId', 'type'],
      },
    },
    execute: (args, ctx) => {
      const fromZoneId = args.fromZoneId as string;
      const type = args.type as string;
      const nearestOpen = !!args.nearestOpen;
      const needsAccessible = !!ctx.fanContext?.accessibility;

      // M11: for accessibility-flagged fans, include the accessible variant of
      // the requested amenity so prioritizeAccessibleFacilities can promote it.
      let candidates = POIS.filter(
        p => p.type === type || (needsAccessible && p.type === `${type}_accessible`)
      );
      if (nearestOpen) {
        candidates = candidates.filter(p => p.status !== 'closed');
      }

      // BFS to find shortest hop count
      const distances: Record<string, number> = { [fromZoneId]: 0 };
      const queue: string[] = [fromZoneId];

      while (queue.length > 0) {
        const curr = queue.shift()!;
        const dist = distances[curr];
        const edges = getEdgesFrom(curr);
        for (const edge of edges) {
          if (distances[edge.to] === undefined) {
            distances[edge.to] = dist + 1;
            queue.push(edge.to);
          }
        }
      }

      const scored = candidates
        .map(poi => ({
          poi,
          distance: distances[poi.nearestZone] !== undefined ? distances[poi.nearestZone] : Infinity,
        }))
        .filter(item => item.distance !== Infinity)
        .sort((a, b) => {
          if (a.distance !== b.distance) {
            return a.distance - b.distance;
          }
          // Tie break by POI ID alphabetically for deterministic tests
          return a.poi.id.localeCompare(b.poi.id);
        })
        .slice(0, 3)
        .map(item => item.poi);

      // M11 facility prioritization: promote an accessible variant to the top
      // when it is comparably close to the nearest standard amenity.
      if (needsAccessible && scored.length > 1) {
        return prioritizeAccessibleFacilities(scored, fromZoneId, true);
      }

      return scored;
    },
  },

  getForecast: {
    schema: {
      name: 'getForecast',
      description: 'Looks up crowd density forecasts and peak congestion estimates for a zone.',
      parameters: {
        type: 'object',
        properties: {
          zoneId: { type: 'string', description: 'Zone ID to check' },
          timeSec: { type: 'number', description: 'Relative target time in simulation-seconds' },
        },
        required: ['zoneId', 'timeSec'],
      },
    },
    execute: (args, ctx) => {
      const zoneId = args.zoneId as string;
      const timeSec = args.timeSec as number;

      const zone = ZONES.find((z) => z.id === zoneId);
      if (!zone) {
        return { error: 'invalid_zone_id' };
      }

      // Clamp relative target time (e.g. 0 to 7200 seconds / 120 minutes)
      const clampedTimeSec = Math.min(7200, Math.max(0, timeSec));
      const minutesAhead = Math.round(clampedTimeSec / 60);

      // Build ForecastSource from ctx.simSnapshot
      const simState = ctx.simSnapshot;
      const source: ForecastSource =
        simState.timeline && simState.timeline.length > 0
          ? { kind: 'timeline', frames: simState.timeline }
          : {
              kind: 'projection',
              currentDensity: simState.density,
              projectFn: (zId: string, atMatchClockSec: number) => {
                const z = ZONES.find((zn) => zn.id === zId);
                if (!z) return 0;
                return computeBaseDensity(z, atMatchClockSec);
              },
            };

      const forecast = getForecast(zoneId, minutesAhead, simState.matchClockSec, source);
      const peak = getPeakCrush(zoneId, simState.matchClockSec, source);

      return {
        zoneId: forecast.zoneId,
        minutesAhead: forecast.minutesAhead,
        predictedDensity: forecast.predictedDensity,
        extrapolated: forecast.extrapolated,
        peakCrush: {
          peakMatchClockSec: peak.peakMatchClockSec,
          peakDensity: peak.peakDensity,
          minutesFromNow: peak.minutesFromNow,
          extrapolated: peak.extrapolated,
        },
      };
    },
  },

  getPeakCrush: {
    schema: {
      name: 'getPeakCrush',
      description: 'Finds the predicted peak congestion time and value for a given zone.',
      parameters: {
        type: 'object',
        properties: {
          zoneId: { type: 'string', description: 'Zone ID to check' },
        },
        required: ['zoneId'],
      },
    },
    execute: (args, ctx) => {
      const zoneId = args.zoneId as string;

      const zone = ZONES.find((z) => z.id === zoneId);
      if (!zone) {
        return { error: 'invalid_zone_id' };
      }

      // Build ForecastSource from ctx.simSnapshot
      const simState = ctx.simSnapshot;
      const source: ForecastSource =
        simState.timeline && simState.timeline.length > 0
          ? { kind: 'timeline', frames: simState.timeline }
          : {
              kind: 'projection',
              currentDensity: simState.density,
              projectFn: (zId: string, atMatchClockSec: number) => {
                const z = ZONES.find((zn) => zn.id === zId);
                if (!z) return 0;
                return computeBaseDensity(z, atMatchClockSec);
              },
            };

      const peak = getPeakCrush(zoneId, simState.matchClockSec, source);

      return {
        zoneId: peak.zoneId,
        peakMatchClockSec: peak.peakMatchClockSec,
        peakDensity: peak.peakDensity,
        minutesFromNow: peak.minutesFromNow,
        extrapolated: peak.extrapolated,
      };
    },
  },

  detectStress: {
    schema: {
      name: 'detectStress',
      description: 'Evaluates a text message to detect urgency, distress, or emergency signals.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'User text message content' },
        },
        required: ['text'],
      },
    },
    execute: (args) => {
      return detectStressHeuristic(typeof args.text === 'string' ? args.text : '');
    },
  },

  getIncentive: {
    schema: {
      name: 'getIncentive',
      description: 'Finds active operational rewards or detour incentives available starting at a zone.',
      parameters: {
        type: 'object',
        properties: {
          fromZoneId: { type: 'string', description: 'Zone ID' },
        },
        required: ['fromZoneId'],
      },
    },
    execute: (args, ctx) => {
      const fromZoneId = typeof args.fromZoneId === 'string' ? args.fromZoneId : '';
      // Prefer the incentives the browser sent with the request (the store is
      // per-process, so on the server it is always empty); fall back to the
      // store for same-process test environments.
      const incentives = ctx.activeIncentives ?? useIncentiveStore.getState().activeIncentives;
      const active = incentives.find(
        (inc) => inc.fromZone === fromZoneId
      );
      if (active) {
        return {
          found: true,
          id: active.id,
          fromZone: active.fromZone,
          toZone: active.toZone,
          reward: active.reward,
          qrPayload: active.qrPayload,
          expiresAt: active.expiresAt,
        };
      }
      // Explicit "nothing here" contract — an empty-strings placeholder shape
      // reads as a real (blank) incentive to the LLM and invites hallucination.
      return {
        found: false,
        fromZone: fromZoneId,
        message: 'No active incentives are available from this zone right now.',
      };
    },
  },

  getPolicy: {
    schema: {
      name: 'getPolicy',
      description: 'Retrieves official stadium policies, prohibited items rules, and FAQ sections.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search term or question about policies' },
        },
        required: ['query'],
      },
    },
    execute: async (args) => {
      return await retrieve(typeof args.query === 'string' ? args.query : '');
    },
  },

  reportIncident: {
    schema: {
      name: 'reportIncident',
      description: 'Reports an issue or incident to the stadium organizers on behalf of the fan.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['crowd', 'medical', 'assistance', 'security'], description: 'The type of incident' },
          note: { type: 'string', description: 'Description of the issue' }
        },
        required: ['type', 'note']
      }
    },
    execute: (args, ctx) => {
      const type = args.type as 'crowd' | 'medical' | 'assistance' | 'security';
      const note = args.note as string;
      const fanLocation = ctx.fanContext?.location;

      if (!fanLocation) return { error: 'Unknown fan location. Could not report incident.' };

      // The route handler runs in a separate process from the browser's
      // Zustand stores, so the incident is returned on the tool result — the
      // agent surfaces it via meta.reportedIncident and the client applies it
      // to the live simStore (which the organizer dashboard reads).
      const incident: Incident = {
        id: `ai-${Date.now()}`,
        type,
        zoneId: fanLocation,
        note,
        status: 'pending',
        createdAt: ctx.simSnapshot.matchClockSec,
      };

      return {
        success: true,
        incident,
        message: `Successfully reported ${type} issue to the organizers.`,
      };
    }
  },
};

export function getToolSchemas(): ToolSchema[] {
  return Object.values(TOOL_REGISTRY).map(t => t.schema);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  const definition = TOOL_REGISTRY[name];
  if (!definition) {
    throw new UnknownToolError(`Tool '${name}' is not registered in the system`);
  }
  return await definition.execute(args, ctx);
}
