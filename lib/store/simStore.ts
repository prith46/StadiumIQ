import { create } from 'zustand';
import { Zone, SimState, SimConfig, FanContext, TicketData, UploadDataset } from '../types';
import { ZONES } from '../venue/venue';
import {
  DEFAULT_SIM_CONFIG,
  MATCH_START_SEC,
  mergeStatePatch,
  pruneAndCountSessions,
  computeGateStatus,
  blendSensorInfluence,
  decayRoutedLoad,
} from '../simulation/engine';
import { generateTimeline } from '../simulation/timeline';
import { createSimChannel } from '../simulation/channel';
import { validateUploadDatasetObject } from '../validation/uploadDataset';
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
  previousDensity: Record<string, number>; // M22: density snapshot from the prior tick, used to derive flow vectors
  sessionHeartbeats: Record<string, Record<string, number>>; // zoneId -> sessionId -> lastSeenMs
  fanContext: FanContext;
  isOnboardingOverride?: boolean;
  // M29: automatic match sequencer state (null until startAutoSequencer runs)
  sequencerPhase: SequencerPhase | null;
  sequencerSeed: number | null;
  sequencerStartedAtMs: number | null;
  startAutoSequencer: (zones: Zone[]) => void;
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

type SetState = (partial: Partial<SimStore>) => void;
type GetState = () => SimStore;

// Module-level variables to track active execution details
const knownZoneIds = new Set<string>(ZONES.map(z => z.id));
let activeZones: Zone[] = ZONES;
let channelInstance: ReturnType<typeof createSimChannel> | null = null;
let sequencerTickIntervalId: ReturnType<typeof setInterval> | null = null;
let sequencerStarted = false;

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

/** Per-zone live-state records reset by `reset` and used as the store's initial shape. */
function buildInitialSimRecords(zones: Zone[]): {
  density: Record<string, number>;
  sensorCounts: Record<string, number>;
  routedLoad: Record<string, number>;
  gateStatus: Record<string, 'open' | 'congested' | 'closed'>;
} {
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

  return { density, sensorCounts, routedLoad, gateStatus };
}

/**
 * Returns `prev` when `next` holds identical keys/values, so per-tick records
 * that did not actually change keep their object identity — Zustand slice
 * subscribers (the SVG map, gate markers, KPI panels) then skip re-rendering.
 * Once the sequencer reaches its idle phase every record stabilises and the
 * 1s tick stops causing any re-render at all.
 */
function stableRecord<T>(prev: Record<string, T>, next: Record<string, T>): Record<string, T> {
  const nextKeys = Object.keys(next);
  if (nextKeys.length !== Object.keys(prev).length) return next;
  for (const key of nextKeys) {
    if (!Object.is(prev[key], next[key])) return next;
  }
  return prev;
}

/**
 * Applies a scenario patch to local state, registering density/gate values as
 * manual overrides so the sequencer holds (then decays) them instead of
 * overwriting them on its next tick. Shared by the local `applyScenario`
 * action and the cross-tab SCENARIO receive path — the ONLY difference is
 * that the local action also broadcasts.
 */
function applyScenarioLocal(
  patch: Partial<SimState>,
  isGodMode: boolean | undefined,
  set: SetState,
  get: GetState
): void {
  const state = get();
  const now = Date.now();

  const newDensityOverrides = { ...state.manualDensityOverrides };
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
}

/** Reset of the sim-state records shared by the local `reset` action and the cross-tab RESET receive path. */
function applyResetLocal(zones: Zone[], config: SimConfig | undefined, set: SetState): void {
  const cfg = config || DEFAULT_SIM_CONFIG;

  knownZoneIds.clear();
  zones.forEach(z => knownZoneIds.add(z.id));
  activeZones = zones;

  const { density, sensorCounts, routedLoad, gateStatus } = buildInitialSimRecords(zones);
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
}

/**
 * Registers the persistent cross-tab channel listener exactly once per
 * process. Called from the live startup path (startAutoSequencer), so the
 * SCENARIO/IMPORT/RESET/HEARTBEAT/SOS broadcasts posted by store actions are
 * actually received by other tabs. Receive paths call the *Local helpers
 * (never the broadcasting actions) so an incoming message is never re-posted —
 * re-posting RESET, for example, would ping-pong between tabs forever.
 */
function ensureChannelListener(set: SetState, get: GetState): void {
  if (channelInstance) return;

  channelInstance = createSimChannel((msg) => {
    const state = get();
    if ('senderId' in msg && msg.senderId === state.sessionId) return;

    if (msg.type === 'HEARTBEAT') {
      if (msg.sessionId !== state.sessionId && knownZoneIds.has(msg.zoneId)) {
        const sh = { ...state.sessionHeartbeats };
        if (!sh[msg.zoneId]) sh[msg.zoneId] = {};
        sh[msg.zoneId][msg.sessionId] = msg.timestamp;
        set({ sessionHeartbeats: sh });
      }
    } else if (msg.type === 'SCENARIO') {
      applyScenarioLocal(msg.patch, undefined, set, get);
    } else if (msg.type === 'RESET') {
      applyResetLocal(activeZones, undefined, set);
    } else if (msg.type === 'IMPORT') {
      // Defense in depth: the sender validated before posting, but a channel
      // message is still an external input — re-validate before applying.
      const result = validateUploadDatasetObject(msg.dataset);
      if (result.valid && result.data) {
        applyScenarioLocal(result.data, undefined, set, get);
      }
    } else if (msg.type === 'sos_trigger') {
      set({
        sos: {
          active: true,
          triggeredBy: msg.triggeredBy,
          triggeredAtSec: msg.atSec,
        },
      });
    } else if (msg.type === 'sos_clear') {
      set({
        sos: {
          active: false,
          triggeredBy: null,
          triggeredAtSec: msg.atSec,
        },
      });
    }
    // SEQUENCER_INIT is handled by the dedicated join channel in startAutoSequencer.
  });
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
  set: SetState,
  get: GetState
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

    const now = Date.now();
    // Overrides live for the full hold + decay window (30s + 20s) so
    // resolveOverriddenDensity can actually run its decay phase; god-mode
    // overrides persist until explicitly cleared (Reset / clearManualOverrides).
    const overrideLifetimeSec = OVERRIDE_HOLD_SEC + OVERRIDE_DECAY_SEC;

    // Lazily clean expired override entries out of the record
    const updatedDensityOverrides = { ...state.manualDensityOverrides };
    let densityOverridesChanged = false;
    Object.entries(state.manualDensityOverrides).forEach(([zoneId, override]) => {
      if (!override.isGodMode && (now - override.setAtMs) / 1000 >= overrideLifetimeSec) {
        delete updatedDensityOverrides[zoneId];
        densityOverridesChanged = true;
      }
    });

    const updatedGateStatusOverrides = { ...state.manualGateStatusOverrides };
    let gateStatusOverridesChanged = false;
    Object.entries(state.manualGateStatusOverrides).forEach(([zoneId, override]) => {
      if ((now - override.setAtMs) / 1000 >= overrideLifetimeSec) {
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

    // Live-state upkeep ported from the retired F3 engine tick (the pieces
    // still needed by the sequencer path): fan-as-sensor session TTL pruning
    // into sensorCounts, and M8 routedLoad decay. The local fan's own
    // heartbeat is refreshed first so their presence never expires while the
    // session is alive.
    const refreshedHeartbeats = { ...state.sessionHeartbeats };
    const ownLocation = state.fanContext.location;
    if (ownLocation && knownZoneIds.has(ownLocation)) {
      refreshedHeartbeats[ownLocation] = {
        ...(refreshedHeartbeats[ownLocation] ?? {}),
        [state.sessionId]: now,
      };
    }
    const { pruned, counts } = pruneAndCountSessions(refreshedHeartbeats, now);
    const sensorCounts: Record<string, number> = {};
    for (const zone of zones) {
      sensorCounts[zone.id] = counts[zone.id] ?? 0;
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

      const autoVal = blendSensorInfluence(base, sensorCounts[zone.id] ?? 0);

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

    // M8: routedLoad decays multiplicatively each tick and resets outright at
    // phase boundaries (pre → live → post), since a phase change invalidates
    // the routing pressure accumulated in the previous phase.
    const crossedPhaseBoundary = state.sequencerPhase !== null && state.sequencerPhase !== seq.phase;

    // Reference-stabilise every per-tick record: replacing an unchanged map
    // with a value-identical new object forced the whole SVG map (and every
    // other slice subscriber) to re-render each second even when nothing
    // visibly changed — at idle the entire tick is now render-free.
    set({
      matchClockSec: seq.matchClockSec,
      density: stableRecord(state.density, density),
      previousDensity: state.density,
      gateStatus: stableRecord(state.gateStatus, gateStatus),
      sequencerPhase: seq.phase,
      sessionHeartbeats: pruned,
      sensorCounts: stableRecord(state.sensorCounts, sensorCounts),
      routedLoad: stableRecord(
        state.routedLoad,
        crossedPhaseBoundary ? {} : decayRoutedLoad(state.routedLoad)
      ),
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

/**
 * Test hook: tears down the module-level simulation lifecycle (sequencer
 * interval, channel, once-per-process guard) so each test can start the
 * sequencer fresh. Mirrors resetRateLimits() in lib/server/rateLimit.ts.
 */
export function resetSimLifecycleForTests(): void {
  if (sequencerTickIntervalId) {
    clearInterval(sequencerTickIntervalId);
    sequencerTickIntervalId = null;
  }
  if (channelInstance) {
    channelInstance.close();
    channelInstance = null;
  }
  sequencerStarted = false;
  knownZoneIds.clear();
  ZONES.forEach((z) => knownZoneIds.add(z.id));
  activeZones = ZONES;
}

export const useSimStore = create<SimStore>((set, get) => {
  const defaultSessionId = generateSessionId();
  const persistedFanContext = loadPersistedFanContext();

  const { density, sensorCounts, routedLoad, gateStatus } = buildInitialSimRecords(ZONES);

  // Restore the fan's sensor presence in their persisted zone.
  if (persistedFanContext?.location && sensorCounts[persistedFanContext.location] !== undefined) {
    sensorCounts[persistedFanContext.location] += 1;
  }

  return {
    // Identity
    sessionId: defaultSessionId,

    // SimState
    matchClockSec: MATCH_START_SEC,
    density,
    previousDensity: density,
    gateStatus,
    incidents: [],
    routedLoad,
    sensorCounts,
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

      // The persistent cross-tab listener lives on the live startup path so
      // SCENARIO/IMPORT/RESET/HEARTBEAT/SOS posts are actually received.
      ensureChannelListener(set, get);

      let settled = false;

      // Listen briefly for an existing session's { seed, sessionStartedAtMs }
      // broadcast on the SAME channel every other sync mechanism already uses
      // (M14 SOS, SCENARIO, etc.) — reused, not a second channel/topic.
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
      applyScenarioLocal(patch, isGodMode, set, get);

      if (channelInstance) {
        channelInstance.post({
          type: 'SCENARIO',
          patch,
          senderId: get().sessionId,
          timestamp: Date.now(),
        });
      }
    },

    reset: (zones: Zone[], config?: SimConfig) => {
      applyResetLocal(zones, config, set);

      if (channelInstance) {
        channelInstance.post({
          type: 'RESET',
          senderId: get().sessionId,
          timestamp: Date.now(),
        });
      }
    },

    importDataset: (dataset: unknown) => {
      let str: string | undefined;
      try {
        str = JSON.stringify(dataset);
      } catch {
        return { ok: false, error: 'Invalid JSON payload' };
      }
      if (typeof str !== 'string') {
        return { ok: false, error: 'Invalid JSON payload' };
      }
      if (str.length > 200000) {
        return { ok: false, error: 'Dataset too large' };
      }

      // Single source of truth for upload-shape rules: the same validator the
      // UploadPanel runs on raw file text (lib/validation/uploadDataset.ts).
      const result = validateUploadDatasetObject(dataset);
      if (!result.valid || !result.data) {
        return { ok: false, error: result.errors.join(', ') };
      }

      const validated: UploadDataset = result.data;
      applyScenarioLocal(validated, undefined, set, get);

      if (channelInstance) {
        channelInstance.post({
          type: 'IMPORT',
          dataset: validated,
          senderId: get().sessionId,
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
