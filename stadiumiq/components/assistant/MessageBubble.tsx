"use client";

import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  alertLevel?: 'none' | 'info' | 'warn' | 'critical';
  timestamp: Date;
  meta?: { stress?: boolean };
}

interface MessageBubbleProps {
  message: Message;
  onSpeakToggle?: (messageId: string, text: string) => void;
  activeSpeakingId?: string | null;
}

function formatMarkdown(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  return (
    <>
      {lines.map((line, lineIdx) => {
        const parts = line.split(/(\*\*.*?\*\*|\*.*?\*)/g);
        const formattedLine = parts.map((part, index) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={index} className="font-bold text-text-primary">
                {part.slice(2, -2)}
              </strong>
            );
          }
          if (part.startsWith('*') && part.endsWith('*')) {
            return (
              <em key={index} className="italic text-text-primary">
                {part.slice(1, -1)}
              </em>
            );
          }
          return part;
        });

        return (
          <React.Fragment key={lineIdx}>
            {formattedLine}
            {lineIdx < lines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
    </>
  );
}

export const MessageBubble = React.memo(
  ({ message, onSpeakToggle, activeSpeakingId }: MessageBubbleProps) => {
    const isUser = message.role === 'user';
    const timeStr = message.timestamp.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    let bubbleStyle: React.CSSProperties = {};
    let bubbleClass = '';

    if (isUser) {
      bubbleClass = 'bg-[#EFF6FF] text-text-primary border border-accent/15';
    } else {
      bubbleClass = 'bg-surface text-text-primary border border-border shadow-sm';
      if (message.alertLevel === 'warn') {
        bubbleStyle = { borderLeft: '3px solid #FAC775' };
      } else if (message.alertLevel === 'critical') {
        bubbleStyle = { borderLeft: '3px solid #F09595' };
        bubbleClass += ' bg-red-50/20';
      }
    }

    const isStress = message.meta?.stress;

    return (
      <div className={`w-full flex flex-col ${isUser ? 'items-end' : 'items-start'} mb-4`}>
        <div className="max-w-[85%] group relative flex flex-col gap-1">
          <div
            style={bubbleStyle}
            className={`px-4 py-3 rounded-2xl leading-relaxed ${
              isStress ? 'text-base font-medium' : 'text-sm'
            } ${bubbleClass}`}
            tabIndex={0}
          >
            {formatMarkdown(message.content)}
          </div>
          <div className={`flex items-center gap-1.5 px-1.5 mt-0.5 select-none ${isUser ? 'self-end' : 'self-start'}`}>
            {!isUser && onSpeakToggle && (
              <button
                type="button"
                onClick={() => onSpeakToggle(message.id, message.content)}
                title={activeSpeakingId === message.id ? "Stop speaking" : "Speak response"}
                aria-label={activeSpeakingId === message.id ? "Stop speaking" : "Speak response"}
                className={`p-1 rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${
                  activeSpeakingId === message.id
                    ? 'text-accent bg-accent/10'
                    : 'text-text-secondary hover:text-accent hover:bg-canvas/50'
                }`}
              >
                {activeSpeakingId === message.id ? (
                  <VolumeX className="w-3.5 h-3.5 animate-pulse" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
            )}
            <span className="text-[10px] text-text-secondary opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
              {timeStr}
            </span>
          </div>
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => prevProps.message.id === nextProps.message.id && prevProps.message.content === nextProps.message.content
);

MessageBubble.displayName = 'MessageBubble';
