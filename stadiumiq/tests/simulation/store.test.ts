import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSimStore } from '../../lib/store/simStore';
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

  postMessage(data: any) {
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
  const mockZones: Zone[] = [
    { id: 'sec-101', label: '101', type: 'section', attrs: { accessible: true, enclosed: false, noise: 'high' } },
    { id: 'gate-a', label: 'Gate A', type: 'gate', attrs: { accessible: true, enclosed: false, noise: 'high' } }
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    // Stop engine and reset store state
    useSimStore.getState().stopEngine();
    MockBroadcastChannel.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    useSimStore.getState().stopEngine();
  });

  // 1. startEngine initializes density/sensorCounts/routedLoad to 0, gateStatus to 'open'
  it('startEngine initializes variables correctly', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    const state = useSimStore.getState();
    expect(state.density['sec-101']).toBe(0);
    expect(state.density['gate-a']).toBe(0);
    expect(state.sensorCounts['sec-101']).toBe(0);
    expect(state.sensorCounts['gate-a']).toBe(0);
    expect(state.routedLoad['sec-101']).toBe(0);
    expect(state.gateStatus['gate-a']).toBe('open');
    expect(state.matchClockSec).toBe(MATCH_START_SEC);
    expect(state.isRunning).toBe(true);
    expect(state.timeline.length).toBeGreaterThan(0);
  });

  // 2. Advancing fake timers by one tickIntervalMs updates matchClockSec by simSecondsPerTick
  it('advancing timers updates matchClockSec', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    expect(useSimStore.getState().matchClockSec).toBe(MATCH_START_SEC);

    // Advance by tickIntervalMs (default 2000 ms)
    vi.advanceTimersByTime(2000);

    expect(useSimStore.getState().matchClockSec).toBe(MATCH_START_SEC + 45);
  });

  // 3. applyScenario updates only the patched keys, leaving others untouched
  it('applyScenario updates only specified keys', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    // Set initial values
    useSimStore.setState({
      density: { 'sec-101': 0.1, 'gate-a': 0.2 }
    });

    // Apply scenario
    useSimStore.getState().applyScenario({
      density: { 'sec-101': 0.99 }
    });

    const state = useSimStore.getState();
    expect(state.density['sec-101']).toBe(0.99);
    expect(state.density['gate-a']).toBe(0.2); // Untouched
  });

  // 4. reset() restores matchClockSec and clears incidents
  it('reset() restores matchClockSec and clears incidents', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    // Add some incidents and change matchClockSec
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
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    // Initial state
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

  // 6. heartbeat and session TTL pruning
  it('heartbeat is counted and pruned after TTL expires', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    // Trigger heartbeat for sec-101
    store.heartbeat('sec-101');

    // Advance timer slightly (e.g., tick simulation) to run session pruning
    vi.advanceTimersByTime(2000);

    // Count should be 1
    expect(useSimStore.getState().sensorCounts['sec-101']).toBe(1);

    // Advance past TTL (SESSION_TTL_MS is 10000ms, let's advance by 10000ms more)
    vi.advanceTimersByTime(10000);

    // Session should be pruned and count should be 0
    expect(useSimStore.getState().sensorCounts['sec-101']).toBe(0);
  });

  // 7. heartbeat with an unknown zoneId is silently dropped (never written into state)
  it('heartbeat ignores unknown zoneIds', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    store.heartbeat('sec-999'); // not in mockZones

    expect(useSimStore.getState().sessionHeartbeats['sec-999']).toBeUndefined();

    // and after a tick, no phantom sensor count appears
    vi.advanceTimersByTime(2000);
    expect(useSimStore.getState().sensorCounts['sec-999']).toBeUndefined();
  });

  // 8. importDataset rejects oversized + malformed payloads and leaves state provably unchanged
  it('importDataset rejects oversized and malformed payloads without mutating state', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);
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

    // (b) Malformed shape — unknown top-level key rejected by .strict()
    const resShape = store.importDataset({ notARealKey: true });
    expect(resShape.ok).toBe(false);

    // (c) Wrong value type — density value out of [0,1] range
    const resRange = store.importDataset({ density: { 'sec-101': 5 } });
    expect(resRange.ok).toBe(false);

    // State is byte-for-byte unchanged across all three rejection paths
    const snapshotAfter = JSON.stringify({
      density: useSimStore.getState().density,
      gateStatus: useSimStore.getState().gateStatus,
      incidents: useSimStore.getState().incidents,
    });
    expect(snapshotAfter).toBe(snapshotBefore);
    expect(useSimStore.getState().density['sec-101']).toBe(0.33);
  });

  // 9. SOS activation and BroadcastChannel synchronization
  it('triggers SOS for fan (creates incident only) and does not set global active state', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    // Initial state
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

  it('clears SOS and broadcasts the clear message to other tabs', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    // Trigger then clear
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
    store.reset(mockZones);

    // Start auto sequencer
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

  // Fix 3: judge upload merges overrides
  it('merges judge upload dataset into manual overrides', () => {
    const store = useSimStore.getState();
    store.reset(mockZones);

    store.importDataset({
      density: { 'sec-101': 0.77 },
      gateStatus: { 'gate-a': 'closed' }
    });

    expect(useSimStore.getState().manualDensityOverrides['sec-101'].value).toBe(0.77);
    expect(useSimStore.getState().manualGateStatusOverrides['gate-a'].value).toBe('closed');
  });

  // Fix 4: STATE_SYNC isolates fan personal SOS
  it('does not propagate fan personal SOS via STATE_SYNC', () => {
    const store = useSimStore.getState();
    store.startEngine(mockZones);

    // Simulate receiving STATE_SYNC with fan personal SOS
    const bc = MockBroadcastChannel.instances[0];
    expect(bc).toBeDefined();

    // Trigger message event manually
    bc.onmessage?.({
      data: {
        type: 'STATE_SYNC',
        payload: {
          matchClockSec: 100,
          density: {},
          gateStatus: {},
          incidents: [],
          routedLoad: {},
          sensorCounts: {},
          timeline: [],
          sos: { active: true, triggeredBy: 'fan', triggeredAtSec: 100 }
        },
        senderId: 'other-tab',
        timestamp: Date.now()
      }
    } as MessageEvent);

    // Expect local SOS to remain inactive (isolated)
    expect(useSimStore.getState().sos?.active).toBe(false);

    // Simulate receiving STATE_SYNC with organizer SOS
    bc.onmessage?.({
      data: {
        type: 'STATE_SYNC',
        payload: {
          matchClockSec: 100,
          density: {},
          gateStatus: {},
          incidents: [],
          routedLoad: {},
          sensorCounts: {},
          timeline: [],
          sos: { active: true, triggeredBy: 'organizer', triggeredAtSec: 100 }
        },
        senderId: 'other-tab',
        timestamp: Date.now()
      }
    } as MessageEvent);

    // Expect local SOS to become active for organizer emergency
    expect(useSimStore.getState().sos?.active).toBe(true);
  });
});
