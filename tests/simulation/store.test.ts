import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSimStore, resetSimLifecycleForTests } from '../../lib/store/simStore';
import { Zone } from '../../lib/types';
import { MATCH_START_SEC } from '../../lib/simulation/engine';

// Mock BroadcastChannel
class MockBroadcastChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  static instances: MockBroadcastChannel[] = [];

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown) {
    for (const instance of MockBroadcastChannel.instances) {
      if (instance !== this && instance.name === this.name && instance.onmessage) {
        instance.onmessage({ data } as MessageEvent);
      }
    }
  }

  close() {
    const idx = MockBroadcastChannel.instances.indexOf(this);
    if (idx !== -1) {
      MockBroadcastChannel.instances.splice(idx, 1);
    }
  }
}

vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);

describe('Zustand Simulation Store', () => {
  // Real venue ids: importDataset validates zone/gate ids against ZONES.
  const mockZones: Zone[] = [
    { id: 'sec-101', label: '101', type: 'section', attrs: { accessible: true, enclosed: false, noise: 'high' } },
    { id: 'gate-a', label: 'Gate A', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'high' } }
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    resetSimLifecycleForTests();
    MockBroadcastChannel.instances = [];
    useSimStore.getState().reset(mockZones);
  });

  afterEach(() => {
    resetSimLifecycleForTests();
    vi.useRealTimers();
  });

  // 1. reset initializes density/sensorCounts/routedLoad to 0, gateStatus to 'open'
  it('reset initializes variables correctly', () => {
    const state = useSimStore.getState();
    expect(state.density['sec-101']).toBe(0);
    expect(state.density['gate-a']).toBe(0);
    expect(state.sensorCounts['sec-101']).toBe(0);
    expect(state.sensorCounts['gate-a']).toBe(0);
    expect(state.routedLoad['sec-101']).toBe(0);
    expect(state.gateStatus['gate-a']).toBe('open');
    expect(state.matchClockSec).toBe(MATCH_START_SEC);
    expect(state.timeline.length).toBeGreaterThan(0);
  });

  // 2. The auto-sequencer derives the match clock from elapsed wall time
  it('sequencer tick advances the match clock from elapsed wall time', () => {
    useSimStore.getState().startAutoSequencer(mockZones);

    // 200ms join-election window, then the first tick fires
    vi.advanceTimersByTime(250);
    expect(useSimStore.getState().sequencerPhase).toBe('pre');
    const clockAtStart = useSimStore.getState().matchClockSec;
    expect(clockAtStart).toBeLessThanOrEqual(120);

    vi.advanceTimersByTime(5000);
    // Pre-match counts DOWN toward kickoff
    expect(useSimStore.getState().matchClockSec).toBeLessThan(clockAtStart);
    expect(useSimStore.getState().sequencerPhase).toBe('pre');
  });

  // 3. applyScenario updates only the patched keys, leaving others untouched
  it('applyScenario updates only specified keys', () => {
    useSimStore.setState({
      density: { 'sec-101': 0.1, 'gate-a': 0.2 }
    });

    useSimStore.getState().applyScenario({
      density: { 'sec-101': 0.99 }
    });

    const state = useSimStore.getState();
    expect(state.density['sec-101']).toBe(0.99);
    expect(state.density['gate-a']).toBe(0.2); // Untouched
  });

  // 4. reset() restores matchClockSec and clears incidents
  it('reset() restores matchClockSec and clears incidents', () => {
    useSimStore.setState({
      matchClockSec: 1000,
      incidents: [{ id: 'inc-1', type: 'crowd', zoneId: 'sec-101', note: 'Test', status: 'pending', createdAt: 12345 }]
    });

    useSimStore.getState().reset(mockZones);

    const state = useSimStore.getState();
    expect(state.matchClockSec).toBe(MATCH_START_SEC);
    expect(state.incidents.length).toBe(0);
  });

  // 5. importDataset validation checks
  it('importDataset validates data and applies it or returns error', () => {
    useSimStore.setState({
      density: { 'sec-101': 0.1, 'gate-a': 0.2 }
    });

    // Valid payload
    const validPayload = {
      density: { 'sec-101': 0.8 },
      gateStatus: { 'gate-a': 'closed' as const }
    };
    const resValid = useSimStore.getState().importDataset(validPayload);
    expect(resValid.ok).toBe(true);
    expect(useSimStore.getState().density['sec-101']).toBe(0.8);
    expect(useSimStore.getState().gateStatus['gate-a']).toBe('closed');

    // Invalid payload (e.g. density as string)
    const invalidPayload = {
      density: { 'sec-101': 'high' } // density values must be numbers
    };
    const resInvalid = useSimStore.getState().importDataset(invalidPayload);
    expect(resInvalid.ok).toBe(false);
    expect(useSimStore.getState().density['sec-101']).toBe(0.8); // Unchanged
  });

  // 6. heartbeat and session TTL pruning (pruning runs on the sequencer tick)
  it('heartbeat is counted and pruned after TTL expires', () => {
    useSimStore.getState().startAutoSequencer(mockZones);
    vi.advanceTimersByTime(250); // join election completes, ticking begins

    useSimStore.getState().heartbeat('sec-101');

    // Next tick counts the fresh session
    vi.advanceTimersByTime(1000);
    expect(useSimStore.getState().sensorCounts['sec-101']).toBe(1);

    // Advance past SESSION_TTL_MS (10000ms) — session pruned, count drops to 0
    vi.advanceTimersByTime(11000);
    expect(useSimStore.getState().sensorCounts['sec-101']).toBe(0);
  });

  // 7. heartbeat with an unknown zoneId is silently dropped (never written into state)
  it('heartbeat ignores unknown zoneIds', () => {
    useSimStore.getState().startAutoSequencer(mockZones);
    vi.advanceTimersByTime(250);

    useSimStore.getState().heartbeat('sec-999'); // not in mockZones

    expect(useSimStore.getState().sessionHeartbeats['sec-999']).toBeUndefined();

    // and after a tick, no phantom sensor count appears
    vi.advanceTimersByTime(1000);
    expect(useSimStore.getState().sensorCounts['sec-999']).toBeUndefined();
  });

  // 8. importDataset rejects oversized + malformed payloads and leaves state provably unchanged
  it('importDataset rejects oversized and malformed payloads without mutating state', () => {
    const store = useSimStore.getState();
    useSimStore.setState({ density: { 'sec-101': 0.33, 'gate-a': 0.2 } });

    // Snapshot state that must be untouched on rejection paths
    const snapshotBefore = JSON.stringify({
      density: useSimStore.getState().density,
      gateStatus: useSimStore.getState().gateStatus,
      incidents: useSimStore.getState().incidents,
    });

    // (a) Over the 200,000-char cap
    const huge: Record<string, number> = {};
    for (let i = 0; i < 20000; i++) huge['zone-with-a-long-id-' + i] = 0.5;
    const resHuge = store.importDataset({ density: huge });
    expect(resHuge.ok).toBe(false);
    if (!resHuge.ok) expect(resHuge.error).toMatch(/too large/i);

    // (b) Malformed shape — unknown top-level key rejected
    const resShape = store.importDataset({ notARealKey: true });
    expect(resShape.ok).toBe(false);

    // (c) Wrong value type — density value out of [0,1] range
    const resRange = store.importDataset({ density: { 'sec-101': 5 } });
    expect(resRange.ok).toBe(false);

    // (d) Unknown zone id rejected
    const resZone = store.importDataset({ density: { 'sec-999': 0.5 } });
    expect(resZone.ok).toBe(false);

    // State is byte-for-byte unchanged across all rejection paths
    const snapshotAfter = JSON.stringify({
      density: useSimStore.getState().density,
      gateStatus: useSimStore.getState().gateStatus,
      incidents: useSimStore.getState().incidents,
    });
    expect(snapshotAfter).toBe(snapshotBefore);
    expect(useSimStore.getState().density['sec-101']).toBe(0.33);
  });

  // 9. SOS activation
  it('triggers SOS for fan (creates incident only) and does not set global active state', () => {
    const store = useSimStore.getState();
    expect(useSimStore.getState().sos?.active).toBe(false);

    // Set fan location first so incident can be reported
    store.setFanLocation('sec-101');

    // Trigger SOS locally as fan
    store.triggerSos('fan');

    const state = useSimStore.getState();
    expect(state.sos?.active).toBe(false);
    expect(state.incidents.length).toBeGreaterThan(0);
    expect(state.incidents[0].type).toBe('medical');
  });

  it('clears SOS after an organizer trigger', () => {
    const store = useSimStore.getState();

    store.triggerSos('organizer');
    expect(useSimStore.getState().sos?.active).toBe(true);

    store.clearSos();
    const state = useSimStore.getState();
    expect(state.sos?.active).toBe(false);
    expect(state.sos?.triggeredBy).toBeNull();
  });

  // Fix 2: manual density overrides decay during sequencer tick
  it('decays manual overrides during sequencer tick', () => {
    const store = useSimStore.getState();
    store.startAutoSequencer(mockZones);

    // Apply manual override
    store.applyScenario({ density: { 'sec-101': 0.95 } });
    expect(useSimStore.getState().manualDensityOverrides['sec-101'].value).toBe(0.95);

    // Advance fake timers by 35 seconds (35000ms) to let decay progress (30s hold + 5s decay)
    vi.advanceTimersByTime(35000);

    // Verification: auto sequencer should interpolate the value (decaying toward auto value, not snapped to auto yet)
    expect(useSimStore.getState().density['sec-101']).toBeLessThan(0.95);
    expect(useSimStore.getState().density['sec-101']).toBeGreaterThan(0);

    // Advance past the 50-second total window (e.g. 16 more seconds)
    vi.advanceTimersByTime(16000);

    // Overrides should be cleared and resolve to autoComputedValue exactly
    expect(useSimStore.getState().manualDensityOverrides['sec-101']).toBeUndefined();
  });

  // M8: routedLoad upkeep runs on the sequencer tick
  it('decays routedLoad each sequencer tick and resets it across phase boundaries', () => {
    const store = useSimStore.getState();
    store.startAutoSequencer(mockZones);
    vi.advanceTimersByTime(250); // join election completes, ticking begins

    useSimStore.setState({ routedLoad: { 'gate-a': 10 } });
    vi.advanceTimersByTime(1000);

    const decayed = useSimStore.getState().routedLoad['gate-a'];
    expect(decayed).toBeLessThan(10);
    expect(decayed).toBeGreaterThan(0);

    // Re-seed load just before the pre → live boundary (pre phase = 120s of
    // wall time), then cross it: decay alone would leave ~50 * 0.9^6 ≈ 26,
    // so an empty record proves the boundary RESET fired, not just decay.
    vi.advanceTimersByTime(114_000);
    useSimStore.setState({ routedLoad: { 'gate-a': 50 } });
    vi.advanceTimersByTime(6_000);
    expect(useSimStore.getState().sequencerPhase).toBe('live');
    expect(Object.keys(useSimStore.getState().routedLoad).length).toBe(0);
  });

  // Fix 3: judge upload merges overrides
  it('merges judge upload dataset into manual overrides', () => {
    const store = useSimStore.getState();

    store.importDataset({
      density: { 'sec-101': 0.77 },
      gateStatus: { 'gate-a': 'closed' }
    });

    expect(useSimStore.getState().manualDensityOverrides['sec-101'].value).toBe(0.77);
    expect(useSimStore.getState().manualGateStatusOverrides['gate-a'].value).toBe('closed');
  });

  // Cross-tab receive path: SCENARIO patches and organizer SOS from other tabs
  // are applied locally (the listener is registered by startAutoSequencer).
  it('applies SCENARIO patches and organizer SOS received from other tabs', () => {
    const store = useSimStore.getState();
    store.startAutoSequencer(mockZones);
    vi.advanceTimersByTime(250); // join election completes; persistent channel stays

    const bc = MockBroadcastChannel.instances[0];
    expect(bc).toBeDefined();

    bc.onmessage?.({
      data: {
        type: 'SCENARIO',
        patch: { density: { 'sec-101': 0.91 } },
        senderId: 'other-tab',
        timestamp: Date.now(),
      },
    } as MessageEvent);

    // Applied AND registered as a manual override so the local sequencer
    // holds it rather than overwriting it on the next tick.
    expect(useSimStore.getState().density['sec-101']).toBe(0.91);
    expect(useSimStore.getState().manualDensityOverrides['sec-101'].value).toBe(0.91);

    bc.onmessage?.({
      data: {
        type: 'sos_trigger',
        triggeredBy: 'organizer',
        atSec: 10,
        senderId: 'other-tab',
        timestamp: Date.now(),
      },
    } as MessageEvent);

    expect(useSimStore.getState().sos?.active).toBe(true);
    expect(useSimStore.getState().sos?.triggeredBy).toBe('organizer');
  });
});
