"use client";

import React from 'react';
import { useProactiveAlerts } from '@/lib/alerts/useProactiveAlerts';
import { useAlertStore } from '@/lib/store/alertStore';
import { AlertCard } from './AlertCard';
import type { StadiumMapHandle } from '@/lib/assistant/mapActionDispatcher';

interface AlertStackProps {
  mapRef: React.RefObject<StadiumMapHandle | null>;
  inline?: boolean;
  filterKinds?: ('proactive' | 'incentive' | 'safety' | 'ops')[];
}

export const AlertStackComponent: React.FC<AlertStackProps> = ({
  mapRef,
  inline = false,
  filterKinds,
}) => {
  const activeAlerts = useProactiveAlerts();

  const dismissAlert = useAlertStore((s) => s.dismissAlert);

  const alertsToRender = filterKinds
    ? activeAlerts.filter((alert) => filterKinds.includes(alert.kind))
    : activeAlerts;

  // If there are no active alerts, show placeholder for inline or return null
  if (alertsToRender.length === 0) {
    if (inline) {
      return (
        <div className="flex flex-col items-center justify-center py-8 px-4 border border-dashed border-border rounded-xl bg-canvas text-xs text-text-secondary text-center h-32 select-none">
          <p className="font-semibold">No active alerts</p>
          <p className="text-[10px] opacity-75 mt-0.5">System is operating normally.</p>
        </div>
      );
    }
    return null;
  }

  if (inline) {
    return (
      <div className="flex flex-col gap-3 w-full p-1" data-testid="alert-stack-inline">
        {alertsToRender.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onDismiss={dismissAlert}
            mapRef={mapRef}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="fixed top-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-3 w-auto sm:w-full sm:max-w-sm max-h-[85vh] overflow-y-auto pointer-events-none p-1"
      data-testid="alert-stack"
    >
      <div className="flex flex-col gap-3 w-full pointer-events-auto">
        {alertsToRender.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onDismiss={dismissAlert}
            mapRef={mapRef}
          />
        ))}
      </div>
    </div>
  );
};

export const AlertStack = React.memo(AlertStackComponent);
