import { create } from 'zustand';
import { z } from 'zod';
import { Zone, SimState, SimConfig, Incident, DensityFrame, FanContext, TicketData } from '../types';
import { ZONES } from '../venue/venue';
import {
  DEFAULT_SIM_CONFIG,
  MATCH_START_SEC,
  tickSimulation,
  mergeStatePatch,
  pruneAndCountSessions,
  computeGateStatus,
  blendSensorInfluence,
} from '../simulation/engine';
import { generateTimeline } from '../simulation/timeline';
import { createSimChannel, ChannelMessage } from '../simulation/channel';
import {
  computeSequencerState,
  initSequencer,
  ingressDensityForZone,
  liveDensityForZone,
  egressDensityForZone,
  getScheduledLiveIncidents,
  PRE_MATCH_DURATION_SEC,
  LIVE_PHASE_END_SEC,
  EGRESS_DURATION_SEC,
  SequencerPhase,
} from '../simulation/matchSequencer';
import { resolveOverriddenDensity, ManualOverride, OVERRIDE_HOLD_SEC, OVERRIDE_DECAY_SEC } from '../engine/overrideDecay';

interface SimStore extends SimState {
  sessionId: string;
  isRunning: boolean;
  previousDensity: Record<string, number>; // M22: density snapshot from the prior tick, used to derive flow vectors
  sessionHeartbeats: Record<string, Record<string, number>>; // zoneId -> sessionId -> lastSeenMs
  fanContext: FanContext;
  isOnboardingOverride?: boolean;
  // M29: automatic match sequencer state (null until startAutoSequencer runs)
  sequencerPhase: SequencerPhase | null;
  sequencerSeed: number | null;
  sequencerStartedAtMs: number | null;
  startAutoSequencer: (zones: Zone[]) => void;
  startEngine: (zones: Zone[], config?: SimConfig) => void;
  stopEngine: () => void;
  heartbeat: (zoneId: string) => void;
  applyScenario: (patch: Partial<SimState>, isGodMode?: boolean) => void;
  reset: (zones: Zone[], config?: SimConfig) => void;
  importDataset: (dataset: unknown) => { ok: true } | { ok: false; error: string };
  setFanLocation: (zoneId: string) => void;
  setFanTicket: (ticket: TicketData) => void;
  setFanLanguage: (language: string) => void;
  setSensoryPreferences: (sensory: Partial<NonNullable<FanContext['sensory']>>) => void;
  setIsOnboardingOverride: (val: boolean) => void;
  triggerSos: (triggeredBy: 'fan' | 'organizer') => void;
  clearSos: () => void;
  incrementRoutedLoad: (zoneId: string) => void;
  showCrowdAgents: boolean;
  setShowCrowdAgents: (show: boolean) => void;
  manualDensityOverrides: Record<string, ManualOverride>;
  manualGateStatusOverrides: Record<string, { value: 'open' | 'congested' | 'closed'; setAtMs: number }>;
  clearManualOverrides: () => void;
}

// Module-level variables to track active execution details
const knownZoneIds = new Set<string>(ZONES.map(z => z.id));
let activeZones: Zone[] = ZONES;
let tickIntervalId: any = null;
let channelInstance: ReturnType<typeof createSimChannel> | null = null;
let sequencerTickIntervalId: any = null;
let sequencerStarted = false;

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

// Persists onboarding completion (location + ticket) across reloads so a fan
// isn't sent back to the QR scan screen after refreshing the page.
const FAN_CONTEXT_STORAGE_KEY = 'stadiumiq:fanContext';

type PersistedFanContext = Pick<FanContext, 'language' | 'location' | 'ticket'>;

function loadPersistedFanContext(): PersistedFanContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FAN_CONTEXT_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedFanContext;
  } catch {
    return null;
  }
}

function persistFanContext(fanContext: FanContext): void {
  if (typeof window === 'undefined') return;
  try {
    const toStore: PersistedFanContext = {
      language: fanContext.language,
      location: fanContext.location,
      ticket: fanContext.ticket,
    };
    window.localStorage.setItem(FAN_CONTEXT_STORAGE_KEY, JSON.stringify(toStore));
  } catch {
    // Storage may be unavailable (private browsing, quota) — persistence is best-effort.
  }
}

/**
 * M29: drives matchClockSec/density/gateStatus purely from elapsed wall time
 * (via `computeSequencerState`) instead of a fixed per-tick increment. Runs
 * independently in every tab once each has the same `(seed, sessionStartedAtMs)`
 * — no per-tick broadcast needed, see docs/match-sequencer.md.
 */
function beginSequencerTick(
  seed: number,
  sessionStartedAtMs: number,
  zones: Zone[],
  set: (partial: Partial<SimStore>) => void,
  get: () => SimStore
) {
  set({ sequencerSeed: seed, sequencerStartedAtMs: sessionStartedAtMs, sequencerPhase: 'pre' });

  // Fix 8: scheduled once per session; fired incidents are tracked by index
  // so each one is created at most once as the live-phase clock passes it.
  const sectionZoneIds = zones.filter((z) => z.type === 'section').map((z) => z.id);
  const scheduledLiveIncidents = getScheduledLiveIncidents(seed, sectionZoneIds.length ? sectionZoneIds : zones.map((z) => z.id));
  const firedIncidentIndices = new Set<number>();

  const tick = () => {
    const seq = computeSequencerState(seed, sessionStartedAtMs, Date.now());
    const state = get();

    if (seq.phase === 'live') {
      scheduledLiveIncidents.forEach((sched, idx) => {
        if (firedIncidentIndices.has(idx) || seq.matchClockSec < sched.atSec) return;
        firedIncidentIndices.add(idx);
        const current = get();
        get().applyScenario({
          incidents: [
            ...current.incidents,
            {
              id: `auto-incident-${seed}-${idx}`,
              type: sched.type,
              zoneId: sched.zoneId,
              note: 'Auto-generated incident (live match demo)',
              status: 'pending',
              createdAt: seq.matchClockSec,
            },
          ],
        });
      });
    }

    const OVERRIDE_DECAY_SEC = 20;
    const now = Date.now();

    // Lazily clean expired override entries out of the record
    const updatedDensityOverrides = { ...state.manualDensityOverrides };
    let densityOverridesChanged = false;
    Object.entries(state.manualDensityOverrides).forEach(([zoneId, override]) => {
      if ((now - override.setAtMs) / 1000 >= OVERRIDE_DECAY_SEC) {
        delete updatedDensityOverrides[zoneId];
        densityOverridesChanged = true;
      }
    });

    const updatedGateStatusOverrides = { ...state.manualGateStatusOverrides };
    let gateStatusOverridesChanged = false;
    Object.entries(state.manualGateStatusOverrides).forEach(([zoneId, override]) => {
      if ((now - override.setAtMs) / 1000 >= OVERRIDE_DECAY_SEC) {
        delete updatedGateStatusOverrides[zoneId];
        gateStatusOverridesChanged = true;
      }
    });

    if (densityOverridesChanged || gateStatusOverridesChanged) {
      set({
        manualDensityOverrides: updatedDensityOverrides,
        manualGateStatusOverrides: updatedGateStatusOverrides,
      });
    }

    const density: Record<string, number> = {};
    const gateStatus: Record<string, 'open' | 'congested' | 'closed'> = { ...state.gateStatus };

    for (const zone of zones) {
      let base: number;
      if (seq.phase === 'pre') {
        base = ingressDensityForZone(zone.id, seed, PRE_MATCH_DURATION_SEC - seq.matchClockSec);
      } else if (seq.phase === 'live') {
        base = liveDensityForZone(zone.id, seed, seq.matchClockSec);
      } else if (seq.phase === 'post') {
        // Fix 6: matchClockSec is now baselined to 0 at live-phase start (not
        // raw elapsed time), so egress-phase-elapsed is matchClockSec minus
        // the live phase's own duration, not minus LIVE_PHASE_END_SEC.
        base = egressDensityForZone(zone.id, seed, seq.matchClockSec - (LIVE_PHASE_END_SEC - PRE_MATCH_DURATION_SEC));
      } else {
        base = egressDensityForZone(zone.id, seed, EGRESS_DURATION_SEC);
      }

      const autoVal = blendSensorInfluence(base, state.sensorCounts[zone.id] ?? 0);

      density[zone.id] = resolveOverriddenDensity(
        zone.id,
        updatedDensityOverrides[zone.id],
        autoVal,
        now,
        OVERRIDE_HOLD_SEC,
        OVERRIDE_DECAY_SEC
      );

      if (zone.type === 'gate') {
        const activeGateOverride = updatedGateStatusOverrides[zone.id];
        if (activeGateOverride) {
          gateStatus[zone.id] = activeGateOverride.value;
        } else {
          const prevStatus = state.gateStatus[zone.id];
          const hasIncident = state.incidents.some((inc) => inc.zoneId === zone.id && inc.status !== 'resolved');
          const override = prevStatus === 'closed' || hasIncident ? prevStatus : undefined;
          gateStatus[zone.id] = computeGateStatus(zone, density[zone.id], override);
        }
      }
    }

    set({
      matchClockSec: seq.matchClockSec,
      density,
      previousDensity: state.density,
      gateStatus,
      sequencerPhase: seq.phase,
    });

    if (seq.phase === 'idle' && sequencerTickIntervalId) {
      clearInterval(sequencerTickIntervalId);
      sequencerTickIntervalId = null;
    }
  };

  tick();
  if (sequencerTickIntervalId) clearInterval(sequencerTickIntervalId);
  // Fix 7: the sequencer clock is derived from real elapsed wall time, so it
  // must be re-sampled every real second — reusing the 2000ms sim-engine
  // tick rate (DEFAULT_SIM_CONFIG.tickIntervalMs) made the displayed clock
  // jump by 2s per UI update instead of 1s.
  sequencerTickIntervalId = setInterval(tick, 1000);
}

export const useSimStore = create<SimStore>((set, get) => {
  const defaultSessionId = generateSessionId();
  const persistedFanContext = loadPersistedFanContext();

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

  // Restore the fan's sensor presence in their persisted zone.
  if (persistedFanContext?.location && initialSensorCounts[persistedFanContext.location] !== undefined) {
    initialSensorCounts[persistedFanContext.location] += 1;
  }

  return {
    // Identity
    sessionId: defaultSessionId,
    isRunning: false,

    // SimState
    matchClockSec: MATCH_START_SEC,
    density: initialDensity,
    previousDensity: initialDensity,
    gateStatus: initialGateStatus,
    incidents: [],
    routedLoad: initialRoutedLoad,
    sensorCounts: initialSensorCounts,
    timeline: [],

    // FanContext
    fanContext: {
      language: persistedFanContext?.language ?? 'en',
      location: persistedFanContext?.location,
      accessibility: false,
      sensory: undefined,
      group: undefined,
      leavingEarly: undefined,
      ticket: persistedFanContext?.ticket,
    },

    // SosState
    sos: {
      active: false,
      triggeredBy: null,
      triggeredAtSec: 0,
    },

    isOnboardingOverride: false,

    // M29
    sequencerPhase: null,
    sequencerSeed: null,
    sequencerStartedAtMs: null,

    // Manual overrides
    manualDensityOverrides: {},
    manualGateStatusOverrides: {},

    // Internal Store State
    sessionHeartbeats: {},

    startAutoSequencer: (zones: Zone[]) => {
      if (sequencerStarted) return;
      sequencerStarted = true;

      knownZoneIds.clear();
      zones.forEach((z) => knownZoneIds.add(z.id));
      activeZones = zones;

      let settled = false;

      // Listen briefly for an existing session's { seed, sessionStartedAtMs }
      // broadcast on the SAME channel every other sync mechanism already uses
      // (M14 SOS, STATE_SYNC, etc.) — reused, not a second channel/topic.
      const joinChannel = createSimChannel((msg) => {
        if (settled || msg.type !== 'SEQUENCER_INIT') return;
        settled = true;
        joinChannel.close();
        beginSequencerTick(msg.seed, msg.sessionStartedAtMs, zones, set, get);
      });

      setTimeout(() => {
        if (settled) return;
        settled = true;

        // No existing session found — this tab becomes the source of truth.
        const seq = initSequencer();
        joinChannel.post({
          type: 'SEQUENCER_INIT',
          seed: seq.seed,
          sessionStartedAtMs: seq.sessionStartedAtMs,
          senderId: get().sessionId,
          timestamp: Date.now(),
        });
        joinChannel.close();
        beginSequencerTick(seq.seed, seq.sessionStartedAtMs, zones, set, get);
      }, 200);
    },

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
        previousDensity: density,
        gateStatus,
        incidents: [],
        routedLoad,
        sensorCounts,
        timeline,
        sessionHeartbeats: {},
        sos: {
          active: false,
          triggeredBy: null,
          triggeredAtSec: 0,
        },
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
                // Don't let global sync overwrite a fan's locally-activated personal SOS
                // Also, never globally adopt a fan's personal SOS activation from another tab
                sos: (msg.payload.sos?.active && msg.payload.sos?.triggeredBy === 'organizer')
                  ? msg.payload.sos
                  : (state.sos?.active && state.sos?.triggeredBy === 'fan')
                    ? state.sos
                    : { active: false, triggeredBy: null, triggeredAtSec: 0 },
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
          } else if (msg.type === 'sos_trigger') {
            if (msg.senderId !== state.sessionId) {
              set({
                sos: {
                  active: true,
                  triggeredBy: msg.triggeredBy,
                  triggeredAtSec: msg.atSec,
                },
              });
            }
          } else if (msg.type === 'sos_clear') {
            if (msg.senderId !== state.sessionId) {
              set({
                sos: {
                  active: false,
                  triggeredBy: null,
                  triggeredAtSec: msg.atSec,
                },
              });
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
          previousDensity: state.density,
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

    applyScenario: (patch: Partial<SimState>, isGodMode?: boolean) => {
      const state = get();
      const newDensityOverrides = { ...state.manualDensityOverrides };
      const now = Date.now();
      if (patch.density) {
        Object.entries(patch.density).forEach(([zoneId, val]) => {
          newDensityOverrides[zoneId] = { value: val, setAtMs: now, isGodMode };
        });
      }
      const newGateStatusOverrides = { ...state.manualGateStatusOverrides };
      if (patch.gateStatus) {
        Object.entries(patch.gateStatus).forEach(([zoneId, val]) => {
          newGateStatusOverrides[zoneId] = { value: val, setAtMs: now };
        });
      }
      const merged = mergeStatePatch(state, patch);
      set({
        ...merged,
        manualDensityOverrides: newDensityOverrides,
        manualGateStatusOverrides: newGateStatusOverrides,
      });

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
        previousDensity: density,
        gateStatus,
        incidents: [],
        routedLoad,
        sensorCounts,
        timeline,
        sessionHeartbeats: {},
        sos: {
          active: false,
          triggeredBy: null,
          triggeredAtSec: 0,
        },
        manualDensityOverrides: {},
        manualGateStatusOverrides: {},
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
      
      const newDensityOverrides = { ...state.manualDensityOverrides };
      const now = Date.now();
      if (validated.density) {
        Object.entries(validated.density).forEach(([zoneId, val]) => {
          newDensityOverrides[zoneId] = { value: val, setAtMs: now };
        });
      }
      const newGateStatusOverrides = { ...state.manualGateStatusOverrides };
      if (validated.gateStatus) {
        Object.entries(validated.gateStatus).forEach(([zoneId, val]) => {
          newGateStatusOverrides[zoneId] = { value: val, setAtMs: now };
        });
      }

      const merged = mergeStatePatch(state, validated);
      set({
        ...merged,
        manualDensityOverrides: newDensityOverrides,
        manualGateStatusOverrides: newGateStatusOverrides,
      });

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

    clearManualOverrides: () => {
      set({
        manualDensityOverrides: {},
        manualGateStatusOverrides: {},
      });
    },

    setFanLocation: (zoneId: string) => {
      // Register heartbeat
      get().heartbeat(zoneId);

      // Retrieve fresh state after heartbeat's set() has run
      const state = get();
      const prevLocation = state.fanContext.location;

      // Mutate sensorCounts to prevent double count
      const nextSensorCounts = { ...state.sensorCounts };
      if (prevLocation && nextSensorCounts[prevLocation] !== undefined) {
        nextSensorCounts[prevLocation] = Math.max(0, nextSensorCounts[prevLocation] - 1);
      }
      if (nextSensorCounts[zoneId] !== undefined) {
        nextSensorCounts[zoneId] = (nextSensorCounts[zoneId] || 0) + 1;
      }

      const nextFanContext = {
        ...state.fanContext,
        location: zoneId,
      };
      set({
        fanContext: nextFanContext,
        sensorCounts: nextSensorCounts,
      });
      persistFanContext(nextFanContext);
    },

    setFanTicket: (ticket: TicketData) => {
      const state = get();
      const nextFanContext = {
        ...state.fanContext,
        ticket,
      };
      set({ fanContext: nextFanContext });
      persistFanContext(nextFanContext);
    },

    setFanLanguage: (language: string) => {
      const state = get();
      const nextFanContext = {
        ...state.fanContext,
        language,
      };
      set({ fanContext: nextFanContext });
      persistFanContext(nextFanContext);
    },

    setIsOnboardingOverride: (val: boolean) => {
      set({ isOnboardingOverride: val });
    },

    setSensoryPreferences: (sensory: Partial<NonNullable<FanContext['sensory']>>) => {
      const state = get();
      set({
        fanContext: {
          ...state.fanContext,
          sensory: { ...state.fanContext.sensory, ...sensory },
        },
      });
    },

    incrementRoutedLoad: (zoneId: string) => {
      const state = get();
      const current = state.routedLoad[zoneId] ?? 0;
      set({ routedLoad: { ...state.routedLoad, [zoneId]: current + 1 } });
    },

    triggerSos: (triggeredBy: 'fan' | 'organizer') => {
      const state = get();
      const currentClock = state.matchClockSec;
      
      if (triggeredBy === 'organizer') {
        set({ sos: { active: true, triggeredBy, triggeredAtSec: currentClock } });
        if (channelInstance) {
          channelInstance.post({
            type: 'sos_trigger',
            triggeredBy,
            atSec: currentClock,
            senderId: state.sessionId,
            timestamp: Date.now(),
          });
        }
      } else {
        // Fan personal SOS - do not set local active SOS or broadcast sos_trigger!
        // Report an incident directly to the organizer
        const fanLocation = state.fanContext.location;
        if (fanLocation) {
           const newIncident = {
             id: `sos-${Date.now()}`,
             type: 'medical', // Defaulting to medical/security assistance
             zoneId: fanLocation,
             note: 'Personal SOS activated by fan',
             status: 'pending',
             createdAt: currentClock
           } as const;

           // Use applyScenario so it updates the local store (for single-tab testing)
           // AND automatically broadcasts it over the channel (for multi-tab testing).
           get().applyScenario({ incidents: [...state.incidents, newIncident] });
        }
      }
    },

    clearSos: () => {
      const state = get();
      const currentClock = state.matchClockSec;
      const wasOrganizer = state.sos?.triggeredBy === 'organizer';
      
      set({ sos: { active: false, triggeredBy: null, triggeredAtSec: currentClock } });

      if (wasOrganizer && channelInstance) {
        channelInstance.post({
          type: 'sos_clear',
          triggeredBy: 'organizer',
          atSec: currentClock,
          senderId: state.sessionId,
          timestamp: Date.now(),
        });
      }
    },

    showCrowdAgents: false,
    setShowCrowdAgents: (show: boolean) => set({ showCrowdAgents: show }),
  };
});
