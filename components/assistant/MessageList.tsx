"use client";

import React, { useRef, useEffect } from 'react';
import { useReducedMotion } from 'framer-motion';
import { MessageBubble, Message } from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  isThinking?: boolean;
  onSpeakToggle?: (messageId: string, text: string) => void;
  activeSpeakingId?: string | null;
}

export function MessageList({
  messages,
  isThinking = false,
  onSpeakToggle,
  activeSpeakingId,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (containerRef.current && typeof containerRef.current.scrollTo === 'function') {
      containerRef.current.scrollTo({
        top: containerRef.current.scrollHeight,
        behavior: shouldReduceMotion ? 'auto' : 'smooth',
      });
    }
  }, [messages, isThinking, shouldReduceMotion]);

  return (
    <div
      ref={containerRef}
      className="flex-1 w-full overflow-y-auto px-4 py-2 space-y-1 scrollbar-thin"
    >
      {messages.map((msg) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          onSpeakToggle={onSpeakToggle}
          activeSpeakingId={activeSpeakingId}
        />
      ))}

      {isThinking && (
        <div className="w-full flex items-start mb-4">
          <div className="bg-surface border border-border text-text-primary px-4 py-3 rounded-2xl shadow-sm text-sm flex items-center gap-1">
            {shouldReduceMotion ? (
              <span className="text-text-secondary select-none animate-pulse">Thinking...</span>
            ) : (
              <div className="flex items-center gap-1.5 h-4 px-1" aria-label="Thinking">
                <span className="w-2 h-2 rounded-full bg-accent/60 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-2 h-2 rounded-full bg-accent/70 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-2 h-2 rounded-full bg-accent/80 animate-bounce" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
