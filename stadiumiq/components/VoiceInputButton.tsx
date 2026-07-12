"use client";

import React, { useState, useEffect, useRef } from "react";
import { Mic, MicOff, AlertCircle } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useSimStore } from "../lib/store/simStore";
import { createSpeechRecognizer } from "../lib/voice/speechRecognition";
import { toSpeechLocaleTag } from "../lib/voice/languageTags";

interface VoiceInputButtonProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function VoiceInputButton({ onTranscript, disabled = false }: VoiceInputButtonProps) {
  const language = useSimStore((s) => s.fanContext.language) || "en";
  const shouldReduceMotion = useReducedMotion();

  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const recognizerRef = useRef<ReturnType<typeof createSpeechRecognizer>>(null);

  // Feature detection check on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setIsSupported(!!SpeechRecognition);
    }
  }, []);

  // Clean up SpeechRecognition session on unmount
  useEffect(() => {
    return () => {
      if (recognizerRef.current) {
        recognizerRef.current.stop();
      }
    };
  }, []);

  if (!isSupported) {
    return null; // Return null so the control is completely absent if unsupported
  }

  const handleToggleListening = () => {
    if (disabled) return;

    if (isListening) {
      if (recognizerRef.current) {
        recognizerRef.current.stop();
      }
      setIsListening(false);
    } else {
      setErrorMsg(null);
      const locale = toSpeechLocaleTag(language);

      const recognizer = createSpeechRecognizer(
        locale,
        (result) => {
          onTranscript(result.transcript);
          // Once a transcript is finalized, stop listening instead of
          // leaving the mic open indefinitely (recognition.continuous=true
          // would otherwise keep it running until manually toggled off).
          if (result.isFinal) {
            recognizerRef.current?.stop();
            setIsListening(false);
          }
        },
        (error) => {
          console.error("[VoiceInputButton] Error:", error);
          if (error === "not-allowed") {
            setErrorMsg("Microphone access needed — check your browser settings");
          } else {
            setErrorMsg(`Voice input failed: ${error}`);
          }
          setIsListening(false);
        }
      );

      if (recognizer) {
        recognizerRef.current = recognizer;
        recognizer.start();
        setIsListening(true);
      } else {
        setErrorMsg("Failed to start voice recognition");
      }
    }
  };

  return (
    <div className="relative flex items-center">
      {/* Listening Aura Animation */}
      {isListening && (
        <motion.div
          animate={
            shouldReduceMotion
              ? { scale: 1, opacity: 0.25 }
              : { scale: [1, 1.4, 1], opacity: [0.3, 0.1, 0.3] }
          }
          transition={
            shouldReduceMotion
              ? { duration: 0 }
              : { repeat: Infinity, duration: 1.8, ease: "easeInOut" }
          }
          className="absolute inset-0 bg-accent rounded-lg -z-10"
        />
      )}

      <button
        type="button"
        onClick={handleToggleListening}
        disabled={disabled}
        title={isListening ? "Stop listening" : "Voice input"}
        aria-label={isListening ? "Stop listening" : "Voice input"}
        className={`p-2 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer ${
          isListening
            ? "text-accent bg-accent/10 hover:bg-accent/20"
            : "text-text-secondary hover:text-accent hover:bg-canvas/60"
        }`}
      >
        {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>

      {/* Floating Status / Listening Indicator */}
      {isListening && (
        <span className="absolute left-10 ml-2 bg-accent text-white text-[10px] uppercase font-bold tracking-widest px-2 py-0.5 rounded animate-pulse whitespace-nowrap">
          Listening...
        </span>
      )}

      {/* Inline Permission / Error Banners */}
      {errorMsg && (
        <div className="absolute bottom-10 left-0 bg-surface border border-red-200 text-red-700 text-xs font-semibold p-2.5 rounded-lg shadow-card flex items-center gap-1.5 w-64 z-50 animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="ml-auto text-text-secondary hover:text-text-primary text-[10px] uppercase font-bold"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}
