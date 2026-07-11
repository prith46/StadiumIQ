"use client";

import React from 'react';
import { useIncentiveStore } from '../../lib/store/incentiveStore';
import { IncentiveCard } from './IncentiveCard';
import type { StadiumMapHandle } from '../../lib/assistant/mapActionDispatcher';

import { useProactiveIncentives } from '../../lib/incentives/useProactiveIncentives';

interface IncentiveStackProps {
  mapRef: React.RefObject<StadiumMapHandle | null>;
}

export const IncentiveStackComponent: React.FC<IncentiveStackProps> = ({ mapRef }) => {
  // Read active incentives via the reactive simulation hook
  const activeIncentives = useProactiveIncentives();
  const dismissIncentive = useIncentiveStore((s) => s.dismissIncentive);

  if (activeIncentives.length === 0) {
    return null;
  }

  return (
    <div
      className="fixed bottom-4 right-4 left-4 sm:left-auto z-50 flex flex-col gap-3 w-auto sm:w-full sm:max-w-sm max-h-[45vh] overflow-y-auto pointer-events-none p-1"
      data-testid="incentive-stack"
    >
      <div className="flex flex-col gap-3 w-full pointer-events-auto">
        {activeIncentives.map((incentive) => (
          <IncentiveCard
            key={incentive.id}
            incentive={incentive}
            onDismiss={dismissIncentive}
            mapRef={mapRef}
          />
        ))}
      </div>
    </div>
  );
};

export const IncentiveStack = React.memo(IncentiveStackComponent);
export type IncentiveStack = typeof IncentiveStack;
