import { create } from 'zustand';
import type { Alert } from '../types';

interface AlertStoreState {
  alreadyFired: Record<string, { lastFiredAt: number; zoneId?: string }>;
  activeAlerts: Alert[];
  dismissedAlertIds: string[];
}

interface AlertStoreActions {
  fireAlert: (triggerKey: string, alert: Omit<Alert, 'id' | 'createdAt'>, matchClockSec: number) => void;
  dismissAlert: (id: string) => void;
  reset: () => void;
}

export type AlertStore = AlertStoreState & AlertStoreActions;

export const useAlertStore = create<AlertStore>((set, get) => ({
  // Initial state
  alreadyFired: {},
  activeAlerts: [],
  dismissedAlertIds: [],

  // Actions
  fireAlert: (triggerKey, alertData, matchClockSec) => {
    const { alreadyFired, activeAlerts, dismissedAlertIds } = get();

    // 1. Check cooldown and changes
    const previous = alreadyFired[triggerKey];
    if (previous) {
      const cooldownSec = matchClockSec - previous.lastFiredAt;
      const isWithinCooldown = cooldownSec <= 180; // 3-minute cooldown (180 sim seconds)
      const hasMaterialChanged = alertData.zoneId !== previous.zoneId;

      // Only skip firing if it is within cooldown AND the recommendation (zoneId) hasn't changed.
      // E.g., if a different clearer gate is recommended, it bypasses the cooldown immediately!
      if (isWithinCooldown && !hasMaterialChanged) {
        return;
      }
    }

    // 2. Generate a unique ID and construct Alert object
    const id = `alert-${triggerKey}-${matchClockSec}`;
    
    // Check if this specific alert id was already dismissed in this session
    if (dismissedAlertIds.includes(id)) {
      return;
    }

    const newAlert: Alert = {
      ...alertData,
      id,
      createdAt: matchClockSec,
    };

    // 3. Update state
    set({
      alreadyFired: {
        ...alreadyFired,
        [triggerKey]: { lastFiredAt: matchClockSec, zoneId: alertData.zoneId },
      },
      // Insert on top (most recent on top)
      activeAlerts: [newAlert, ...activeAlerts],
    });
  },

  dismissAlert: (id) => {
    const { activeAlerts, dismissedAlertIds } = get();
    set({
      dismissedAlertIds: [...dismissedAlertIds, id],
      activeAlerts: activeAlerts.filter((a) => a.id !== id),
    });
  },

  reset: () => {
    set({
      alreadyFired: {},
      activeAlerts: [],
      dismissedAlertIds: [],
    });
  },
}));
