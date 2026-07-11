"use client";

import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import type { Alert } from '@/lib/types';
import { EXIT_FADE_MS } from '@/lib/venue/overlayAnimations';
import { dispatchMapActions } from '@/lib/assistant/mapActionDispatcher';
import type { StadiumMapHandle } from '@/lib/assistant/mapActionDispatcher';

interface AlertCardProps {
  alert: Alert;
  onDismiss: (id: string) => void;
  mapRef: React.RefObject<StadiumMapHandle | null>;
}

export const AlertCardComponent: React.FC<AlertCardProps> = ({
  alert,
  onDismiss,
  mapRef,
}) => {
  const [isExiting, setIsExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect prefers-reduced-motion to skip exit animations
  const prefersReducedMotion = useRef(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      prefersReducedMotion.current = mq.matches;
      const handler = (e: MediaQueryListEvent) => {
        prefersReducedMotion.current = e.matches;
      };
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, []);

  // Handle dismiss with plain CSS opacity transition
  const handleDismiss = () => {
    const fadeDuration = prefersReducedMotion.current ? 0 : EXIT_FADE_MS;
    setIsExiting(true);
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    exitTimerRef.current = setTimeout(() => {
      onDismiss(alert.id);
    }, fadeDuration);
  };

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, []);

  const handleActionClick = () => {
    if (alert.zoneId) {
      // Dispatch map actions for highlighting and routing
      const actions = [
        { op: 'highlight' as const, zoneId: alert.zoneId },
        { op: 'pin' as const, zoneId: alert.zoneId },
      ];
      dispatchMapActions(actions, mapRef.current).catch((err) => {
        console.warn('[AlertCard] Failed to dispatch map actions:', err);
      });
    }
  };

  // Border/style class depending on alert priority
  let priorityBorderClass = 'border-l-4 border-slate-400';
  let priorityBgClass = 'bg-white';
  
  if (alert.priority === 1) {
    priorityBorderClass = 'border-l-4 border-red-500';
    priorityBgClass = 'bg-red-50/10 bg-white';
  } else if (alert.priority === 2) {
    priorityBorderClass = 'border-l-4 border-amber-500';
  }

  // WAI-ARIA role selection: alert for high priority (1/2), status for low priority (3)
  const ariaRole = alert.priority === 3 ? 'status' : 'alert';

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
      className={`w-full max-w-sm rounded-xl border border-border shadow-card p-4 relative ${priorityBorderClass} ${priorityBgClass} flex flex-col gap-2.5`}
      role={ariaRole}
    >
      {/* Title & Body */}
      <div className="pr-6">
        <h3 className="font-display font-extrabold text-sm text-text-primary">
          {alert.title}
        </h3>
        <p className="text-xs text-text-secondary mt-1 leading-relaxed">
          {alert.body}
        </p>
      </div>

      {/* Action Button (Show Route) */}
      {alert.action && alert.zoneId && (
        <div className="flex justify-start mt-1">
          <button
            onClick={handleActionClick}
            className="text-[10px] font-bold text-accent hover:bg-accent/10 border border-accent rounded-full px-3 py-1 transition-all"
          >
            {alert.action}
          </button>
        </div>
      )}

      {/* Dismiss Button */}
      <button
        onClick={handleDismiss}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleDismiss();
          }
        }}
        aria-label="Dismiss alert"
        className="absolute top-3 right-3 text-text-secondary hover:text-text-primary rounded p-0.5 focus:outline-none focus:ring-1 focus:ring-accent transition-colors cursor-pointer"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  );
};

export const AlertCard = React.memo(AlertCardComponent);
