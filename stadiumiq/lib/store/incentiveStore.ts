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

    // ID is derived uniquely from source zone and expiresAt simulation timestamp
    const id = `incentive-${incentiveData.fromZone}-${incentiveData.expiresAt}`;

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
export type useIncentiveStore = typeof useIncentiveStore;
