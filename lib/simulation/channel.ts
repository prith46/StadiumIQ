import { SimState, UploadDataset } from '../types';

export type ChannelMessage =
  | { type: 'HEARTBEAT'; zoneId: string; sessionId: string; timestamp: number }
  | { type: 'SCENARIO'; patch: Partial<SimState>; senderId: string; timestamp: number }
  | { type: 'RESET'; senderId: string; timestamp: number }
  | { type: 'IMPORT'; dataset: UploadDataset; senderId: string; timestamp: number }
  | { type: 'sos_trigger'; triggeredBy: 'fan' | 'organizer'; atSec: number; senderId: string; timestamp: number }
  | { type: 'sos_clear'; triggeredBy: 'fan' | 'organizer'; atSec: number; senderId: string; timestamp: number }
  // M29: broadcast ONCE per session by whichever tab starts it — every other
  // tab adopts this seed + start time and independently (re-)derives the
  // identical sequencer state via `computeSequencerState`, rather than this
  // message being repeated per tick. See docs/STADIUMIQ-MASTER-DOCUMENTATION.md §4 (M29).
  | { type: 'SEQUENCER_INIT'; seed: number; sessionStartedAtMs: number; senderId: string; timestamp: number };

export const CHANNEL_NAME = 'stadiumiq';

export function createSimChannel(
  onMessage: (msg: ChannelMessage) => void
): { channel: BroadcastChannel | null; post: (msg: ChannelMessage) => void; close: () => void } {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel === 'undefined') {
    return {
      channel: null,
      post: () => {},
      close: () => {},
    };
  }

  try {
    const channel = new window.BroadcastChannel(CHANNEL_NAME);
    
    channel.onmessage = (event) => {
      const msg = event.data;
      if (isValidChannelMessage(msg)) {
        onMessage(msg);
      }
    };

    const post = (msg: ChannelMessage) => {
      try {
        channel.postMessage(msg);
      } catch (err) {
        console.error('Failed to post message to channel:', err);
      }
    };

    const close = () => {
      try {
        channel.close();
      } catch (err) {
        console.error('Failed to close channel:', err);
      }
    };

    return { channel, post, close };
  } catch (err) {
    console.error('Error creating BroadcastChannel:', err);
    return {
      channel: null,
      post: () => {},
      close: () => {},
    };
  }
}

function isValidChannelMessage(value: unknown): value is ChannelMessage {
  if (!value || typeof value !== 'object') return false;
  const msg = value as Record<string, unknown>;
  if (typeof msg.type !== 'string') return false;
  if (typeof msg.timestamp !== 'number') return false;

  switch (msg.type) {
    case 'HEARTBEAT':
      return typeof msg.zoneId === 'string' && typeof msg.sessionId === 'string';
    case 'SCENARIO':
      return typeof msg.senderId === 'string' && !!msg.patch && typeof msg.patch === 'object';
    case 'RESET':
      return typeof msg.senderId === 'string';
    case 'IMPORT':
      return typeof msg.senderId === 'string' && !!msg.dataset && typeof msg.dataset === 'object';
    case 'sos_trigger':
    case 'sos_clear':
      return typeof msg.senderId === 'string' && (msg.triggeredBy === 'fan' || msg.triggeredBy === 'organizer') && typeof msg.atSec === 'number';
    case 'SEQUENCER_INIT':
      return typeof msg.senderId === 'string' && typeof msg.seed === 'number' && typeof msg.sessionStartedAtMs === 'number';
    default:
      return false;
  }
}
