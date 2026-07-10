import { create } from 'zustand';
import { z } from 'zod';
import { Zone, SimState, SimConfig, Incident, DensityFrame } from '../types';
import { ZONES } from '../venue/venue';
import {
  DEFAULT_SIM_CONFIG,
  MATCH_START_SEC,
  tickSimulation,
  mergeStatePatch,
  pruneAndCountSessions,
} from '../simulation/engine';
import { generateTimeline } from '../simulation/timeline';
import { createSimChannel, ChannelMessage } from '../simulation/channel';

interface SimStore extends SimState {
  sessionId: string;
  isRunning: boolean;
  sessionHeartbeats: Record<string, Record<string, number>>; // zoneId -> sessionId -> lastSeenMs
  startEngine: (zones: Zone[], config?: SimConfig) => void;
  stopEngine: () => void;
  heartbeat: (zoneId: string) => void;
  applyScenario: (patch: Partial<SimState>) => void;
  reset: (zones: Zone[], config?: SimConfig) => void;
  importDataset: (dataset: unknown) => { ok: true } | { ok: false; error: string };
}

// Module-level variables to track active execution details
const knownZoneIds = new Set<string>(ZONES.map(z => z.id));
let activeZones: Zone[] = ZONES;
let tickIntervalId: any = null;
let channelInstance: ReturnType<typeof createSimChannel> | null = null;

// Validation Schema for Incidents
const incidentSchema = z.object({
  id: z.string(),
  type: z.enum(['crowd', 'medical', 'assistance', 'security', 'evacuation']),
  zoneId: z.string(),
  note: z.string(),
  status: z.enum(['pending', 'dispatched', 'resolved']),
  createdAt: z.number(),
  responderId: z.string().optional(),
  etaSec: z.number().optional(),
});

// Validation Schema for imported datasets
const uploadDatasetSchema = z.object({
  density: z.record(z.string(), z.number().min(0).max(1)).optional(),
  incidents: z.array(incidentSchema).optional(),
  gateStatus: z.record(z.string(), z.enum(['open', 'congested', 'closed'])).optional(),
}).strict();

// Helper to generate a session UUID (fallback if crypto.randomUUID is not available in environment)
function generateSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'sess-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
}

export const useSimStore = create<SimStore>((set, get) => {
  const defaultSessionId = generateSessionId();

  // Initial placeholder state
  const initialDensity: Record<string, number> = {};
  const initialSensorCounts: Record<string, number> = {};
  const initialRoutedLoad: Record<string, number> = {};
  const initialGateStatus: Record<string, 'open' | 'congested' | 'closed'> = {};

  for (const zone of ZONES) {
    initialDensity[zone.id] = 0;
    initialSensorCounts[zone.id] = 0;
    initialRoutedLoad[zone.id] = 0;
    if (zone.type === 'gate') {
      initialGateStatus[zone.id] = 'open';
    }
  }

  return {
    // Identity
    sessionId: defaultSessionId,
    isRunning: false,

    // SimState
    matchClockSec: MATCH_START_SEC,
    density: initialDensity,
    gateStatus: initialGateStatus,
    incidents: [],
    routedLoad: initialRoutedLoad,
    sensorCounts: initialSensorCounts,
    timeline: [],

    // Internal Store State
    sessionHeartbeats: {},

    startEngine: (zones: Zone[], config?: SimConfig) => {
      const cfg = config || DEFAULT_SIM_CONFIG;

      if (tickIntervalId) {
        clearInterval(tickIntervalId);
        tickIntervalId = null;
      }

      knownZoneIds.clear();
      zones.forEach(z => knownZoneIds.add(z.id));
      activeZones = zones;

      const density: Record<string, number> = {};
      const sensorCounts: Record<string, number> = {};
      const routedLoad: Record<string, number> = {};
      const gateStatus: Record<string, 'open' | 'congested' | 'closed'> = {};

      for (const zone of zones) {
        density[zone.id] = 0;
        sensorCounts[zone.id] = 0;
        routedLoad[zone.id] = 0;
        if (zone.type === 'gate') {
          gateStatus[zone.id] = 'open';
        }
      }

      const timeline = generateTimeline(zones, cfg.seed);

      set({
        isRunning: true,
        matchClockSec: MATCH_START_SEC,
        density,
        gateStatus,
        incidents: [],
        routedLoad,
        sensorCounts,
        timeline,
        sessionHeartbeats: {},
      });

      if (!channelInstance) {
        channelInstance = createSimChannel((msg) => {
          const state = get();
          if (msg.type === 'STATE_SYNC') {
            if (msg.senderId !== state.sessionId) {
              set({
                matchClockSec: msg.payload.matchClockSec,
                density: msg.payload.density,
                gateStatus: msg.payload.gateStatus,
                incidents: msg.payload.incidents,
                routedLoad: msg.payload.routedLoad,
                sensorCounts: msg.payload.sensorCounts,
                timeline: msg.payload.timeline,
              });
            }
          } else if (msg.type === 'HEARTBEAT') {
            if (msg.sessionId !== state.sessionId && knownZoneIds.has(msg.zoneId)) {
              const sh = { ...state.sessionHeartbeats };
              if (!sh[msg.zoneId]) sh[msg.zoneId] = {};
              sh[msg.zoneId][msg.sessionId] = msg.timestamp;
              set({ sessionHeartbeats: sh });
            }
          } else if (msg.type === 'SCENARIO') {
            if (msg.senderId !== state.sessionId) {
              const merged = mergeStatePatch(state, msg.patch);
              set(merged);
            }
          } else if (msg.type === 'RESET') {
            if (msg.senderId !== state.sessionId) {
              get().reset(activeZones, cfg);
            }
          } else if (msg.type === 'IMPORT') {
            if (msg.senderId !== state.sessionId) {
              const merged = mergeStatePatch(state, msg.dataset);
              set(merged);
            }
          }
        });
      }

      tickIntervalId = setInterval(() => {
        const state = get();
        const { pruned, counts } = pruneAndCountSessions(state.sessionHeartbeats, Date.now());

        const newSensorCounts: Record<string, number> = {};
        for (const zone of activeZones) {
          newSensorCounts[zone.id] = counts[zone.id] ?? 0;
        }

        const updatedStateForTick = {
          ...state,
          sessionHeartbeats: pruned,
          sensorCounts: newSensorCounts,
        };

        const nextState = tickSimulation(updatedStateForTick, activeZones, cfg);

        set({
          ...nextState,
          sessionHeartbeats: pruned,
          sensorCounts: newSensorCounts,
        });

        if (channelInstance) {
          channelInstance.post({
            type: 'STATE_SYNC',
            payload: get(),
            senderId: get().sessionId,
            timestamp: Date.now(),
          });
        }
      }, cfg.tickIntervalMs);
    },

    stopEngine: () => {
      if (tickIntervalId) {
        clearInterval(tickIntervalId);
        tickIntervalId = null;
      }
      if (channelInstance) {
        channelInstance.close();
        channelInstance = null;
      }
      set({ isRunning: false });
    },

    heartbeat: (zoneId: string) => {
      if (!knownZoneIds.has(zoneId)) return;
      const state = get();
      const sh = { ...state.sessionHeartbeats };
      if (!sh[zoneId]) sh[zoneId] = {};
      const now = Date.now();
      sh[zoneId][state.sessionId] = now;
      set({ sessionHeartbeats: sh });

      if (channelInstance) {
        channelInstance.post({
          type: 'HEARTBEAT',
          zoneId,
          sessionId: state.sessionId,
          timestamp: now,
        });
      }
    },

    applyScenario: (patch: Partial<SimState>) => {
      const state = get();
      const merged = mergeStatePatch(state, patch);
      set(merged);

      if (channelInstance) {
        channelInstance.post({
          type: 'SCENARIO',
          patch,
          senderId: state.sessionId,
          timestamp: Date.now(),
        });
      }
    },

    reset: (zones: Zone[], config?: SimConfig) => {
      const cfg = config || DEFAULT_SIM_CONFIG;
      const wasRunning = get().isRunning;

      if (tickIntervalId) {
        clearInterval(tickIntervalId);
        tickIntervalId = null;
      }

      knownZoneIds.clear();
      zones.forEach(z => knownZoneIds.add(z.id));
      activeZones = zones;

      const density: Record<string, number> = {};
      const sensorCounts: Record<string, number> = {};
      const routedLoad: Record<string, number> = {};
      const gateStatus: Record<string, 'open' | 'congested' | 'closed'> = {};

      for (const zone of zones) {
        density[zone.id] = 0;
        sensorCounts[zone.id] = 0;
        routedLoad[zone.id] = 0;
        if (zone.type === 'gate') {
          gateStatus[zone.id] = 'open';
        }
      }

      const timeline = generateTimeline(zones, cfg.seed);

      set({
        matchClockSec: MATCH_START_SEC,
        density,
        gateStatus,
        incidents: [],
        routedLoad,
        sensorCounts,
        timeline,
        sessionHeartbeats: {},
      });

      if (wasRunning) {
        tickIntervalId = setInterval(() => {
          const state = get();
          const { pruned, counts } = pruneAndCountSessions(state.sessionHeartbeats, Date.now());

          const newSensorCounts: Record<string, number> = {};
          for (const zone of activeZones) {
            newSensorCounts[zone.id] = counts[zone.id] ?? 0;
          }

          const updatedStateForTick = {
            ...state,
            sessionHeartbeats: pruned,
            sensorCounts: newSensorCounts,
          };

          const nextState = tickSimulation(updatedStateForTick, activeZones, cfg);

          set({
            ...nextState,
            sessionHeartbeats: pruned,
            sensorCounts: newSensorCounts,
          });

          if (channelInstance) {
            channelInstance.post({
              type: 'STATE_SYNC',
              payload: get(),
              senderId: get().sessionId,
              timestamp: Date.now(),
            });
          }
        }, cfg.tickIntervalMs);
      }

      if (channelInstance) {
        channelInstance.post({
          type: 'RESET',
          senderId: get().sessionId,
          timestamp: Date.now(),
        });
      }
    },

    importDataset: (dataset: unknown) => {
      let str = '';
      try {
        str = JSON.stringify(dataset);
      } catch (err) {
        return { ok: false, error: 'Invalid JSON payload' };
      }

      if (str.length > 200000) {
        return { ok: false, error: 'Dataset too large' };
      }

      const result = uploadDatasetSchema.safeParse(dataset);
      if (!result.success) {
        return { ok: false, error: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ') };
      }

      const validated = result.data;
      const state = get();
      const merged = mergeStatePatch(state, validated);
      set(merged);

      if (channelInstance) {
        channelInstance.post({
          type: 'IMPORT',
          dataset: validated,
          senderId: state.sessionId,
          timestamp: Date.now(),
        });
      }

      return { ok: true };
    },
  };
});
