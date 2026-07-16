"use client";

import React from 'react';
import { Ticket, Camera } from 'lucide-react';
import { VoiceInputButton } from '../VoiceInputButton';

interface AssistantEntryPointsProps {
  onVoiceTranscript?: (text: string) => void;
  onTicketScanRequest?: () => void;
  onCameraRequest?: () => void;
  disabled?: boolean;
}

export function AssistantEntryPoints({
  onVoiceTranscript,
  onTicketScanRequest,
  onCameraRequest,
  disabled = false,
}: AssistantEntryPointsProps) {
  return (
    <div className="flex items-center gap-1">
      <VoiceInputButton
        onTranscript={(text) => onVoiceTranscript?.(text)}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={onTicketScanRequest}
        title="Scan ticket"
        aria-label="Scan ticket"
        className="p-2 rounded-lg text-text-secondary hover:text-accent hover:bg-canvas/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Ticket className="w-5 h-5" />
      </button>
      <button
        type="button"
        onClick={onCameraRequest}
        title="Camera scan"
        aria-label="Camera scan"
        className="p-2 rounded-lg text-text-secondary hover:text-accent hover:bg-canvas/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Camera className="w-5 h-5" />
      </button>
    </div>
  );
}
