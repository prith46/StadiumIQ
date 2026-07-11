import { SimState, UploadDataset } from '../types';

export type ChannelMessage =
  | { type: 'STATE_SYNC'; payload: SimState; senderId: string; timestamp: number }
  | { type: 'HEARTBEAT'; zoneId: string; sessionId: string; timestamp: number }
  | { type: 'SCENARIO'; patch: Partial<SimState>; senderId: string; timestamp: number }
  | { type: 'RESET'; senderId: string; timestamp: number }
  | { type: 'IMPORT'; dataset: UploadDataset; senderId: string; timestamp: number }
  | { type: 'sos_trigger'; triggeredBy: 'fan' | 'organizer'; atSec: number; senderId: string; timestamp: number }
  | { type: 'sos_clear'; triggeredBy: 'fan' | 'organizer'; atSec: number; senderId: string; timestamp: number };

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
      if (
        msg &&
        typeof msg === 'object' &&
        ['STATE_SYNC', 'HEARTBEAT', 'SCENARIO', 'RESET', 'IMPORT', 'sos_trigger', 'sos_clear'].includes(msg.type)
      ) {
        onMessage(msg as ChannelMessage);
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
