import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSimChannel, ChannelMessage } from '../../lib/simulation/channel';

// Save whatever the environment provides so each test can restore it.
const originalBC = (window as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;

function setBC(value: unknown) {
  (window as unknown as { BroadcastChannel?: unknown }).BroadcastChannel = value;
}

afterEach(() => {
  setBC(originalBC);
  vi.restoreAllMocks();
});

describe('createSimChannel resilience & validation', () => {
  // Task 8: degrades to a safe no-op when BroadcastChannel is unavailable (SSR / old Safari).
  it('returns a no-op channel (no throw) when BroadcastChannel is unavailable', () => {
    setBC(undefined);
    const onMessage = vi.fn();

    const sim = createSimChannel(onMessage);

    expect(sim.channel).toBeNull();
    // post/close are safe no-ops: callable, return undefined (void), never throw.
    expect(sim.post({ type: 'RESET', senderId: 's', timestamp: 1 })).toBeUndefined();
    expect(sim.close()).toBeUndefined();
    expect(onMessage).not.toHaveBeenCalled();
  });

  // Task 7: incoming messages are filtered by msg.type against the five known literals;
  // anything else is ignored without throwing.
  it('ignores messages whose type is not one of the five known literals', () => {
    const created: MockChannel[] = [];
    class MockChannel {
      name: string;
      onmessage: ((e: MessageEvent) => void) | null = null;
      constructor(name: string) { this.name = name; created.push(this); }
      postMessage() {}
      close() {}
    }
    setBC(MockChannel);

    const onMessage = vi.fn();
    createSimChannel(onMessage);
    const instance = created[0];
    expect(instance).toBeTruthy();

    // Unknown / malformed payloads -> ignored (onMessage never fires), no throw.
    instance.onmessage!({ data: { type: 'BOGUS' } } as MessageEvent);
    instance.onmessage!({ data: null } as MessageEvent);
    instance.onmessage!({ data: 'not-an-object' } as unknown as MessageEvent);
    instance.onmessage!({ data: { type: 42 } } as unknown as MessageEvent);
    expect(onMessage).not.toHaveBeenCalled();

    // A known type is delivered
    const good: ChannelMessage = { type: 'RESET', senderId: 's', timestamp: 1 };
    instance.onmessage!({ data: good } as MessageEvent);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(good);
  });
});
