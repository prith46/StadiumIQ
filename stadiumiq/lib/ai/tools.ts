import { Zone, SimState, FanContext } from '../types';
import { POIS, getEdgesFrom } from '../venue/venue';
import { retrieve } from './rag';

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
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolDefinition {
  schema: ToolSchema;
  execute: (args: Record<string, any>, ctx: ToolContext) => Promise<unknown> | unknown;
}

export function detectStressHeuristic(text: string): { stress: boolean; matchedSignals: string[] } {
  const signals: string[] = [];
  const lower = text.toLowerCase();

  const keywords = [
    'help',
    'scared',
    "can't breathe",
    'cant breathe',
    'lost my',
    'emergency',
    'panic',
    'fire',
    'danger',
    'injured',
    'evacuate',
    'stuck',
  ];
  
  for (const keyword of keywords) {
    if (lower.includes(keyword)) {
      signals.push(`keyword:${keyword}`);
    }
  }

  if (text.includes('!!')) {
    signals.push('exclamation');
  }

  if (text.length > 10) {
    let alphaCount = 0;
    let upperCount = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (/[a-zA-Z]/.test(char)) {
        alphaCount++;
        if (char === char.toUpperCase()) {
          upperCount++;
        }
      }
    }
    if (alphaCount > 0 && (upperCount / alphaCount) > 0.6) {
      signals.push('all-caps');
    }
  }

  return {
    stress: signals.length > 0,
    matchedSignals: signals,
  };
}

export const TOOL_REGISTRY: Record<string, ToolDefinition> = {
  computeRoute: {
    schema: {
      name: 'computeRoute',
      description: 'Calculates the optimal walking path and ETA between zones in the stadium.',
      parameters: {
        type: 'object',
        properties: {
          fromZoneId: { type: 'string', description: 'Starting zone ID' },
          toZoneId: { type: 'string', description: 'Ending zone ID' },
          accessibility: { type: 'boolean', description: 'Whether the route must be step-free' },
        },
        required: ['fromZoneId', 'toZoneId'],
      },
    },
    execute: (args) => {
      // TODO(M3): Replace with lib/engine/routing.ts computeRoute() once M3 lands.
      return {
        path: [] as string[],
        etaSec: 0,
        reason: { crowdedZones: [] as string[], avoidedGates: [] as string[] },
        __stub: true,
      };
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
    execute: (args) => {
      const fromZoneId = args.fromZoneId as string;
      const type = args.type as string;
      const nearestOpen = !!args.nearestOpen;

      let candidates = POIS.filter(p => p.type === type);
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
    execute: () => {
      // TODO(M7): Replace with real forecasting lookup from simulation snapshot.
      return {
        predictedDensity: {} as Record<string, number>,
        peakCrushAtSec: null as number | null,
        __stub: true,
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
      return detectStressHeuristic(args.text || '');
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
    execute: (args) => {
      // TODO(M9): Replace with dynamic detouring incentives registry lookup.
      return {
        id: '',
        fromZone: args.fromZoneId ?? '',
        toZone: '',
        reward: '',
        qrPayload: '',
        expiresAt: 0,
        __stub: true,
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
      return await retrieve(args.query || '');
    },
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
