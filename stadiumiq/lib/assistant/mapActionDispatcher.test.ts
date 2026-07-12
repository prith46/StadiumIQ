import { describe, it, expect, vi } from 'vitest';
import { dispatchMapActions, StadiumMapHandle, MapAction } from './mapActionDispatcher';

describe('Map action dispatcher', () => {
  it('correctly maps highlight, route, and pin operations', async () => {
    const handle: StadiumMapHandle = {
      highlightZone: vi.fn(),
      drawRoute: vi.fn().mockResolvedValue(undefined),
      dropPin: vi.fn(),
      clearOverlay: vi.fn(),
    };

    const actions: MapAction[] = [
      { op: 'highlight', zoneId: 'sec-214' },
      { op: 'route', path: ['sec-214', 'gate-a'] },
      { op: 'pin', zoneId: 'sec-108' },
    ];

    await dispatchMapActions(actions, handle);

    expect(handle.highlightZone).toHaveBeenCalledWith('sec-214');
    expect(handle.drawRoute).toHaveBeenCalledWith(['sec-214', 'gate-a']);
    expect(handle.dropPin).toHaveBeenCalledWith('sec-108', 'incident');
  });

  it('normalizes a bare section number to the real prefixed zone id (Fix 7)', async () => {
    const handle: StadiumMapHandle = {
      highlightZone: vi.fn(),
      drawRoute: vi.fn().mockResolvedValue(undefined),
      dropPin: vi.fn(),
      clearOverlay: vi.fn(),
    };

    const actions: MapAction[] = [
      { op: 'highlight', zoneId: '205' }, // bare id — should resolve to 'sec-205'
      { op: 'pin', zoneId: '108' },
    ];

    await dispatchMapActions(actions, handle);

    expect(handle.highlightZone).toHaveBeenCalledWith('sec-205');
    expect(handle.dropPin).toHaveBeenCalledWith('sec-108', 'incident');
  });

  it('skips and logs warnings on malformed actions', async () => {
    const handle: StadiumMapHandle = {
      highlightZone: vi.fn(),
      drawRoute: vi.fn().mockResolvedValue(undefined),
      dropPin: vi.fn(),
      clearOverlay: vi.fn(),
    };

    const actions: MapAction[] = [
      { op: 'highlight' }, // missing zoneId
      { op: 'route', path: [] }, // empty path
      { op: 'pin' }, // missing zoneId
      { op: 'unknown' as any }, // unknown operation
    ];

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await dispatchMapActions(actions, handle);

    expect(handle.highlightZone).not.toHaveBeenCalled();
    expect(handle.drawRoute).not.toHaveBeenCalled();
    expect(handle.dropPin).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('isolates throw errors so subsequent actions continue to execute', async () => {
    const handle: StadiumMapHandle = {
      highlightZone: vi.fn().mockImplementation(() => {
        throw new Error('Highlight fail');
      }),
      drawRoute: vi.fn().mockResolvedValue(undefined),
      dropPin: vi.fn(),
      clearOverlay: vi.fn(),
    };

    const actions: MapAction[] = [
      { op: 'highlight', zoneId: 'sec-214' }, // throws
      { op: 'route', path: ['sec-214', 'gate-a'] }, // should execute
    ];

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await dispatchMapActions(actions, handle);

    expect(handle.highlightZone).toHaveBeenCalledWith('sec-214');
    expect(handle.drawRoute).toHaveBeenCalledWith(['sec-214', 'gate-a']);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('fails silently and logs warning if handle is null', async () => {
    const actions: MapAction[] = [{ op: 'highlight', zoneId: 'sec-214' }];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(dispatchMapActions(actions, null)).resolves.not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // M5 NEW TESTS
  // -------------------------------------------------------------------------

  it('calls clearOverlay exactly once per dispatchMapActions batch (regression test)', async () => {
    const handle: StadiumMapHandle = {
      highlightZone: vi.fn(),
      drawRoute: vi.fn().mockResolvedValue(undefined),
      dropPin: vi.fn(),
      clearOverlay: vi.fn(),
    };

    const actions: MapAction[] = [
      { op: 'highlight', zoneId: 'sec-214' },
      { op: 'route', path: ['sec-214', 'gate-a'] },
      { op: 'pin', zoneId: 'sec-108' },
    ];

    await dispatchMapActions(actions, handle);

    expect(handle.clearOverlay).toHaveBeenCalledTimes(1);
  });

  it('sequencing: delays dropPin until drawRoute resolves when pin is at the route destination', async () => {
    let resolveRoute: () => void = () => {};
    const routePromise = new Promise<void>((resolve) => {
      resolveRoute = resolve;
    });

    const handle: StadiumMapHandle = {
      highlightZone: vi.fn(),
      drawRoute: vi.fn().mockReturnValue(routePromise),
      dropPin: vi.fn(),
      clearOverlay: vi.fn(),
    };

    const actions: MapAction[] = [
      { op: 'route', path: ['sec-214', 'gate-a'] },
      { op: 'pin', zoneId: 'gate-a', kind: 'incident' },
    ];

    const dispatchPromise = dispatchMapActions(actions, handle);

    // Let microtasks run so that dispatchMapActions executes up to the first await
    await Promise.resolve();

    // At this point, drawRoute should have been called, but dropPin should NOT
    expect(handle.drawRoute).toHaveBeenCalledWith(['sec-214', 'gate-a']);
    expect(handle.dropPin).not.toHaveBeenCalled();

    // Resolve the route drawing
    resolveRoute();

    // Await completion of dispatchMapActions
    await dispatchPromise;

    // Now dropPin should have been called
    expect(handle.dropPin).toHaveBeenCalledWith('gate-a', 'incident');
  });

  it('concurrency: does not delay unrelated actions in the batch', async () => {
    // A route draw that takes time to resolve
    const routePromise = new Promise<void>(() => {}); // never resolves

    const handle: StadiumMapHandle = {
      highlightZone: vi.fn(),
      drawRoute: vi.fn().mockReturnValue(routePromise),
      dropPin: vi.fn(),
      clearOverlay: vi.fn(),
    };

    // A pin at a zone that is NOT the route terminal destination
    const actions: MapAction[] = [
      { op: 'route', path: ['sec-214', 'gate-a'] },
      { op: 'pin', zoneId: 'sec-108', kind: 'incident' },
    ];

    const dispatchPromise = dispatchMapActions(actions, handle);

    // Let microtasks run
    await Promise.resolve();

    // Even though the route draw promise never resolves, dropPin for sec-108
    // should fire immediately since it is not the destination of that route.
    expect(handle.drawRoute).toHaveBeenCalled();
    expect(handle.dropPin).toHaveBeenCalledWith('sec-108', 'incident');

    // Clean up/prevent unhandled promise warnings
    vi.restoreAllMocks();
  });
});

