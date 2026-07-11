"use client";

import React, { useState, KeyboardEvent, ChangeEvent } from 'react';
import { Send } from 'lucide-react';
import { AssistantEntryPoints } from './AssistantEntryPoints';

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  onVoiceTranscript?: (text: string) => void;
  onTicketScanRequest?: () => void;
  onCameraRequest?: () => void;
}

export function ChatInput({
  onSend,
  disabled = false,
  onVoiceTranscript,
  onTicketScanRequest,
  onCameraRequest,
}: ChatInputProps) {
  const [text, setText] = useState('');

  const handleSend = () => {
    const trimmed = text.trim();
    if (trimmed && !disabled) {
      onSend(trimmed);
      setText('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChange = (e: KeyboardEvent<HTMLTextAreaElement> | ChangeEvent<HTMLTextAreaElement>) => {
    setText((e.target as any).value);
  };

  const handleVoiceTranscript = (transcript: string) => {
    setText(transcript);
    if (onVoiceTranscript) {
      onVoiceTranscript(transcript);
    }
  };

  const isSendDisabled = disabled || !text.trim();

  return (
    <div className="w-full bg-surface border border-border rounded-xl focus-within:ring-2 focus-within:ring-accent focus-within:border-accent overflow-hidden transition-shadow duration-150 shadow-sm">
      <textarea
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Message the assistant..."
        aria-label="Message the assistant"
        rows={2}
        className="w-full px-4 pt-3 pb-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary/60 focus:outline-none resize-none"
      />
      <div className="flex items-center justify-between px-3 py-2 border-t border-border/50 bg-canvas/30">
        <AssistantEntryPoints
          onVoiceTranscript={handleVoiceTranscript}
          onTicketScanRequest={onTicketScanRequest}
          onCameraRequest={onCameraRequest}
          disabled={disabled}
        />
        <button
          type="button"
          disabled={isSendDisabled}
          onClick={handleSend}
          title="Send message"
          aria-label="Send message"
          className="p-1.5 rounded-lg bg-accent text-white hover:bg-accent/95 disabled:bg-accent/40 disabled:text-white/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
