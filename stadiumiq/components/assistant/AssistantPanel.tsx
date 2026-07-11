"use client";

import React, { useState, RefObject, useEffect } from 'react';
import { useSimStore } from '../../lib/store/simStore';
import { sendAssistantMessage, AssistantResponse, AssistantRequest } from '../../lib/assistant/client';
import { dispatchMapActions, StadiumMapHandle } from '../../lib/assistant/mapActionDispatcher';
import { MessageList } from './MessageList';
import { Message } from './MessageBubble';
import { QuickActionChips } from './QuickActionChips';
import { ChatInput } from './ChatInput';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { useA11yStore } from '../../lib/store/a11yStore';
import { speak, stopSpeaking } from '../../lib/voice/speechSynthesis';
import { toSpeechLocaleTag } from '../../lib/voice/languageTags';
import { evaluateStressEscalation } from '../../lib/engine/stressEscalation';

interface AssistantPanelProps {
  mapRef: RefObject<StadiumMapHandle | null>;
  onVoiceTranscript?: (text: string) => void;
  onTicketScanRequest?: () => void;
  onCameraRequest?: () => void;
}

export function AssistantPanel({
  mapRef,
  onVoiceTranscript,
  onTicketScanRequest,
  onCameraRequest,
}: AssistantPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastUserMessageText, setLastUserMessageText] = useState<string | null>(null);
  const [activeSpeakingId, setActiveSpeakingId] = useState<string | null>(null);

  const ttsEnabled = useA11yStore((state) => state.ttsEnabled);

  // Stop speaking if TTS is turned off
  useEffect(() => {
    if (!ttsEnabled) {
      stopSpeaking();
      setActiveSpeakingId(null);
    }
  }, [ttsEnabled]);

  // Cleanup synthesis on unmount
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, []);

  const handleSpeakToggle = (messageId: string, textContent: string) => {
    if (activeSpeakingId === messageId) {
      stopSpeaking();
      setActiveSpeakingId(null);
    } else {
      const locale = toSpeechLocaleTag(fanContext.language || 'en');
      const spoke = speak(textContent, locale, () => {
        setActiveSpeakingId(null);
      });
      if (spoke) {
        setActiveSpeakingId(messageId);
      }
    }
  };

  // Retrieve current fanContext from the store
  const fanContext = useSimStore((state) => state.fanContext);
  const sosActive = useSimStore((state) => state.sos?.active ?? false);
  const matchClockSec = useSimStore((state) => state.matchClockSec);
  const incidents = useSimStore((state) => state.incidents);
  const applyScenario = useSimStore((state) => state.applyScenario);

  const [isCalmMode, setIsCalmMode] = useState(false);

  const handleSendMessage = (text: string, isRetry = false) => {
    if (!text.trim()) return;

    // Interrupt any active speaking streams on new message
    stopSpeaking();
    setActiveSpeakingId(null);

    setErrorMsg(null);
    setLastUserMessageText(text);

    let nextMessages = [...messages];
    
    if (!isRetry) {
      // Evaluate stress escalation & auto-create incident
      const newIncident = evaluateStressEscalation({
        message: text,
        fanContext,
        matchClockSec,
        existingIncidents: incidents,
      });
      if (newIncident) {
        applyScenario({
          incidents: [...incidents, newIncident],
        });
      }

      const userMsg: Message = {
        id: `user-${Date.now()}-${Math.random()}`,
        role: 'user',
        content: text,
        timestamp: new Date(),
      };
      nextMessages = [...nextMessages, userMsg];
      setMessages(nextMessages);
    }

    setIsThinking(true);

    const historyPayload = nextMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const requestBody: AssistantRequest = {
      message: text,
      history: historyPayload,
      fanContext,
    };

    let partialMessageId = `assistant-partial-${Date.now()}`;
    let isStreamingStarted = false;

    sendAssistantMessage(requestBody, {
      onToken: (partialText) => {
        setIsThinking(false);
        setMessages((prev) => {
          if (!isStreamingStarted) {
            isStreamingStarted = true;
            const newAssistantMsg: Message = {
              id: partialMessageId,
              role: 'assistant',
              content: partialText,
              timestamp: new Date(),
              alertLevel: 'none',
            };
            return [...prev, newAssistantMsg];
          } else {
            return prev.map((msg) =>
              msg.id === partialMessageId ? { ...msg, content: partialText } : msg
            );
          }
        });
      },
      onComplete: (fullResponse) => {
        setIsThinking(false);
        const finalMsgId = `assistant-${Date.now()}-${Math.random()}`;
        
        if (fullResponse.meta?.stress) {
          setIsCalmMode(true);
        } else {
          setIsCalmMode(false);
        }

        setMessages((prev) => {
          // Remove partial if it was added, otherwise add complete
          const filtered = prev.filter((msg) => msg.id !== partialMessageId);
          const finalMsg: Message = {
            id: finalMsgId,
            role: 'assistant',
            content: fullResponse.message,
            alertLevel: fullResponse.alertLevel,
            timestamp: new Date(),
            meta: fullResponse.meta,
          };
          return [...filtered, finalMsg];
        });

        // Speak response if enabled
        if (ttsEnabled) {
          const locale = toSpeechLocaleTag(fanContext.language || 'en');
          const spoke = speak(fullResponse.message, locale, () => {
            setActiveSpeakingId(null);
          });
          if (spoke) {
            setActiveSpeakingId(finalMsgId);
          }
        }

        // Dispatch map actions to mapRef ref handle
        if (fullResponse.mapActions && fullResponse.mapActions.length > 0) {
          dispatchMapActions(fullResponse.mapActions, mapRef.current).catch((err) => {
            console.warn('[AssistantPanel] Failed to dispatch map actions:', err);
          });
        }
      },
      onError: (err) => {
        setIsThinking(false);
        setErrorMsg("Something went wrong — try again");
        console.error('[AssistantPanel] Chat fetch failed:', err);
      },
    });
  };

  const handleRetry = () => {
    if (lastUserMessageText) {
      handleSendMessage(lastUserMessageText, true);
    }
  };

  const isEmpty = messages.length === 0;

  return (
    <div className="w-full h-full flex flex-col bg-surface border border-border rounded-2xl overflow-hidden shadow-sm">
      {/* Header */}
      <div className={`px-4 py-3 text-white flex items-center justify-between border-b transition-colors duration-300 ${
        isCalmMode ? 'bg-teal-900 border-teal-950/10' : 'bg-accent border-accent-dark/10'
      }`}>
        <div>
          <h3 className="font-bold text-sm">Stadium Assistant</h3>
          <p className="text-[10px] text-white/80">
            {isCalmMode ? 'Calm Mode Active' : 'Digital Twin Grounding Layer'}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full animate-pulse ${isCalmMode ? 'bg-teal-400' : 'bg-green-400'}`} />
          <span className="text-[10px] uppercase font-bold tracking-wider text-white/90">
            {isCalmMode ? 'Calm Mode' : 'Grounded AI'}
          </span>
        </div>
      </div>

      {/* Main chat log viewport */}
      <div
        role="log"
        aria-live="polite"
        className="flex-1 w-full flex flex-col overflow-hidden min-h-0"
      >
        {isEmpty ? (
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none bg-canvas/10">
            <div className="w-12 h-12 rounded-full bg-accent/10 text-accent flex items-center justify-center mb-3">
              <svg className="w-6 h-6 stroke-current" fill="none" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h4 className="font-bold text-text-primary text-sm">Ask me anything about the stadium</h4>
            <p className="text-xs text-text-secondary mt-1 max-w-[220px]">
              Navigate to seats, check queue status, or find nearby concessions.
            </p>
            {!isCalmMode && (
              <div className="mt-6 w-full max-w-xs">
                <QuickActionChips onSelect={(text) => handleSendMessage(text)} disabled={isThinking} />
              </div>
            )}
          </div>
        ) : (
          <MessageList
            messages={messages}
            isThinking={isThinking}
            onSpeakToggle={handleSpeakToggle}
            activeSpeakingId={activeSpeakingId}
          />
        )}
      </div>

      {/* Inline error state indicator banner */}
      {errorMsg && (
        <div className="px-4 py-3 border-t border-red-100 bg-red-50/50 flex items-center justify-between text-xs text-red-700 animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={handleRetry}
            className="flex items-center gap-1 font-semibold text-accent hover:text-accent-dark transition-colors px-2 py-1 rounded bg-accent/5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Input container footer */}
      <div className="p-3 bg-canvas/20 border-t border-border/80 flex flex-col gap-2">
        {!isEmpty && !isCalmMode && (
          <QuickActionChips onSelect={(text) => handleSendMessage(text)} disabled={isThinking || sosActive} />
        )}
        {isCalmMode && (
          <div className="px-3 py-2 bg-teal-50 border border-teal-200 text-teal-800 text-xs rounded-xl flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse shrink-0" />
            <span>On-site staff has been notified of your location. Please stay calm.</span>
          </div>
        )}
        <ChatInput
          onSend={(text) => handleSendMessage(text)}
          disabled={isThinking || sosActive}
          onVoiceTranscript={onVoiceTranscript}
          onTicketScanRequest={onTicketScanRequest}
          onCameraRequest={onCameraRequest}
        />
      </div>
    </div>
  );
}
