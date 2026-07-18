"use client";

import React, { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import QRCode from 'qrcode';
import { useSimStore } from '../../lib/store/simStore';
import { dispatchMapActions, StadiumMapHandle } from '../../lib/assistant/mapActionDispatcher';
import { computeServiceRoute } from '../../lib/engine/routingService';
import { EXIT_FADE_MS } from '../../lib/venue/overlayAnimations';
import type { Incentive } from '../../lib/types';

interface IncentiveCardProps {
  incentive: Incentive;
  onDismiss: (id: string) => void;
  mapRef: React.RefObject<StadiumMapHandle | null>;
}

export const IncentiveCard: React.FC<IncentiveCardProps> = ({
  incentive,
  onDismiss,
  mapRef,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isExiting, setIsExiting] = useState(false);

  // Subscribe reactively to the simulation clock
  const matchClockSec = useSimStore((state) => state.matchClockSec);

  const secondsRemaining = incentive.expiresAt - matchClockSec;
  const isExpired = secondsRemaining <= 0;
  const shouldAutoDismiss = secondsRemaining <= -10; // 10s simulated grace period

  // Skip exit animations under prefers-reduced-motion — same source of truth
  // as every other animated component (framer-motion's reactive hook).
  const prefersReducedMotion = useReducedMotion();

  // Handle manual dismiss with fade transition
  const handleDismiss = React.useCallback(() => {
    if (isExiting) return;
    const fadeDuration = prefersReducedMotion ? 0 : EXIT_FADE_MS;
    setIsExiting(true);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => {
      onDismiss(incentive.id);
    }, fadeDuration);
  }, [incentive.id, onDismiss, isExiting, prefersReducedMotion]);

  // Trigger auto-dismiss after the grace period. Scheduled on a zero-delay
  // timer so the state transition happens outside the synchronous effect body
  // (dismissal is timer-driven either way — this just makes the first hop
  // explicit).
  useEffect(() => {
    if (!shouldAutoDismiss || isExiting) return;
    const id = setTimeout(handleDismiss, 0);
    return () => clearTimeout(id);
  }, [shouldAutoDismiss, isExiting, handleDismiss]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  // Secure QR Rendering: generates code directly to canvas (no dangerouslySetInnerHTML)
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(
        canvasRef.current,
        incentive.qrPayload,
        {
          margin: 1,
          width: 90,
          color: {
            dark: isExpired ? '#94a3b8' : '#2563eb', // Dimmed slate vs. FIFA-blue
            light: '#ffffff',
          },
        },
        (err) => {
          if (err) {
            console.error('[IncentiveCard] QR Canvas render failed:', err);
          }
        }
      );
    }
  }, [incentive.qrPayload, isExpired]);

  // Accepting the incentive routes the user to the target POI
  const handleAcceptClick = () => {
    if (isExpired || isExiting) return;

    const route = computeServiceRoute(
      { kind: 'zone', zoneId: incentive.toZone },
      undefined,
      incentive.fromZone
    );

    if (!('error' in route)) {
      const actions = [
        { op: 'route' as const, path: route.path },
        { op: 'highlight' as const, zoneId: incentive.toZone },
        { op: 'pin' as const, zoneId: incentive.toZone },
      ];
      dispatchMapActions(actions, mapRef.current).catch((err) => {
        console.warn('[IncentiveCard] Failed to dispatch map actions:', err);
      });
    }
  };

  // Format MM:SS with clamping to 00:00
  const formatTime = (secs: number) => {
    const total = Math.max(0, secs);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const formattedCountdown = formatTime(secondsRemaining);

  return (
    <motion.div
      layout
      initial={{ x: 50, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 350, damping: 25 }}
      style={{
        transition: `opacity ${EXIT_FADE_MS}ms ease`,
        opacity: isExiting ? 0 : 1,
      }}
      className={`w-full max-w-sm rounded-xl border border-border shadow-card p-4 relative border-l-4 border-l-blue-500 bg-white flex flex-col gap-3 ${
        isExpired ? 'opacity-65 grayscale-[30%]' : ''
      }`}
      role="status"
      aria-live="polite"
      aria-label={`Special offer: ${incentive.reward}. Expires in ${formattedCountdown}`}
    >
      <div className="flex gap-4 items-start">
        {/* QR Code Canvas Frame */}
        <div className="relative border border-slate-200 rounded-lg p-1 bg-white flex-shrink-0 flex items-center justify-center">
          <canvas
            ref={canvasRef}
            className="w-[90px] h-[90px]"
            aria-label="Incentive QR Code"
            role="img"
          />
          {isExpired && (
            <div className="absolute inset-0 bg-white/70 flex items-center justify-center rounded-lg">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                Expired
              </span>
            </div>
          )}
        </div>

        {/* Text & Details */}
        <div className="flex-1 flex flex-col gap-1 pr-6">
          <span className="text-[10px] font-bold text-blue-600 tracking-wider uppercase">
            Exclusive Reward Offer
          </span>
          <h3 className="font-display font-extrabold text-sm text-text-primary leading-tight">
            {incentive.reward}
          </h3>
          <p className="text-[11px] text-text-secondary leading-relaxed">
            Avoid the bottlenecks! Take the clearer route.
          </p>

          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] font-bold text-slate-400">Expires:</span>
            <span
              className={`text-xs font-mono font-bold ${
                isExpired ? 'text-red-500' : 'text-blue-600'
              }`}
            >
              {formattedCountdown}
            </span>
          </div>
        </div>
      </div>

      {/* Action Button & Dismiss */}
      <div className="flex justify-between items-center mt-1">
        <button
          onClick={handleAcceptClick}
          disabled={isExpired}
          className={`text-xs font-extrabold px-4 py-1.5 rounded-full border transition-all ${
            isExpired
              ? 'border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed'
              : 'border-blue-600 text-blue-600 hover:bg-blue-50/50'
          }`}
        >
          View Clear Reroute
        </button>

        <button
          onClick={handleDismiss}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleDismiss();
            }
          }}
          className="text-xs text-text-secondary hover:text-text-primary px-3 py-1.5 hover:bg-slate-100 rounded-lg transition-colors font-medium"
        >
          Dismiss
        </button>
      </div>
    </motion.div>
  );
};
