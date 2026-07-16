import { create } from 'zustand';
import type { Incentive } from '../types';

interface IncentiveStoreState {
  activeIncentives: Incentive[];
  alreadyOffered: Record<string, number>;
  dismissedIncentiveIds: string[];
}

interface IncentiveStoreActions {
  offerIncentive: (incentive: Omit<Incentive, 'id'>, matchClockSec: number) => void;
  dismissIncentive: (id: string) => void;
  reset: () => void;
}

export type IncentiveStore = IncentiveStoreState & IncentiveStoreActions;

export const useIncentiveStore = create<IncentiveStore>((set, get) => ({
  // Initial state
  activeIncentives: [],
  alreadyOffered: {},
  dismissedIncentiveIds: [],

  // Actions
  offerIncentive: (incentiveData, matchClockSec) => {
    const { activeIncentives, alreadyOffered, dismissedIncentiveIds } = get();

    // Cooldown check (300 sim seconds / 5 simulated minutes)
    const lastOffered = alreadyOffered[incentiveData.fromZone];
    if (lastOffered !== undefined && matchClockSec - lastOffered <= 300) {
      return;
    }

    // Stable per-minute ID (M9 §5): derived from fromZone/toZone and the
    // matchClockSec minute bucket, NOT expiresAt. expiresAt drifts by 1 sim
    // second on every tick (expiresAt = matchClockSec + 300), so keying off it
    // minted a "new" id on every single tick the bottleneck persisted — the
    // cooldown check below still worked, but the id was never stable, which
    // defeated any caller (or future svc) that dedupes by id membership rather
    // than by re-invoking offerIncentive.
    const id = `incentive-${incentiveData.fromZone}-${incentiveData.toZone}-${Math.floor(matchClockSec / 60)}`;

    if (dismissedIncentiveIds.includes(id)) {
      return;
    }

    // Prevent duplicates in active list
    if (activeIncentives.some((i) => i.id === id)) {
      return;
    }

    const newIncentive: Incentive = {
      ...incentiveData,
      id,
    };

    set({
      alreadyOffered: {
        ...alreadyOffered,
        [incentiveData.fromZone]: matchClockSec,
      },
      activeIncentives: [newIncentive, ...activeIncentives],
    });
  },

  dismissIncentive: (id) => {
    const { activeIncentives, dismissedIncentiveIds } = get();
    set({
      dismissedIncentiveIds: [...dismissedIncentiveIds, id],
      activeIncentives: activeIncentives.filter((i) => i.id !== id),
    });
  },

  reset: () => {
    set({
      activeIncentives: [],
      alreadyOffered: {},
      dismissedIncentiveIds: [],
    });
  },
}));
