"use client";

import React, { useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useSimStore } from '../../lib/store/simStore';
import { QrPanel } from './QrPanel';
import { BlockPicker } from './BlockPicker';
import { TicketScanCard } from './TicketScanCard';
import { ZONES } from '../../lib/venue/venue';
import { TicketData } from '../../lib/types';

interface OnboardingScreenProps {
  onComplete: () => void;
}

type OnboardingStep = 'select' | 'confirming' | 'ticket';

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [step, setStep] = useState<OnboardingStep>('select');
  const [showPicker, setShowPicker] = useState(false);
  const [pendingZoneId, setPendingZoneId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const setFanLocation = useSimStore((s) => s.setFanLocation);
  const setFanTicket = useSimStore((s) => s.setFanTicket);
  const shouldReduceMotion = useReducedMotion();

  // Find info about the pending zone for the confirmation screen
  const pendingZoneInfo = React.useMemo(() => {
    if (!pendingZoneId) return null;
    const zone = ZONES.find((z) => z.id === pendingZoneId);
    if (!zone) return null;
    const tierLabel = zone.tier === 1 ? 'Lower Tier' : zone.tier === 2 ? 'Mid Tier' : 'Upper Tier';
    return {
      label: zone.label,
      tier: tierLabel,
    };
  }, [pendingZoneId]);

  const handleZoneSelected = (zoneId: string) => {
    setErrorMsg(null);
    setPendingZoneId(zoneId);
    setStep('confirming');
  };

  // Run the confirmation phase
  useEffect(() => {
    if (step !== 'confirming' || !pendingZoneId || !pendingZoneInfo) return;

    // Trigger screen reader live announcement
    const text = `Location set to Section ${pendingZoneInfo.label}`;
    setAnnouncement(text);

    const timer = setTimeout(() => {
      try {
        setFanLocation(pendingZoneId);
        setStep('ticket');
      } catch (err) {
        setErrorMsg("Couldn't set your location — try again");
        setStep('select');
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [step, pendingZoneId, pendingZoneInfo, setFanLocation]);

  const handleTicketScanned = (ticket: TicketData) => {
    try {
      setFanTicket(ticket);
      onComplete();
    } catch (err) {
      setErrorMsg("Couldn't sync your ticket — try again");
    }
  };

  const handleRetry = () => {
    if (pendingZoneId) {
      setErrorMsg(null);
      setStep('confirming');
    }
  };

  const handlePickerError = (msg: string) => {
    setErrorMsg(msg);
  };

  return (
    <div className="flex items-center justify-center py-10 w-full min-h-[500px]">
      {/* Screen Reader Announcements */}
      <div className="sr-only" aria-live="polite" role="status">
        {announcement}
      </div>

      <div className="w-full max-w-sm bg-surface px-6 py-8 rounded-xl shadow-card border border-border flex flex-col gap-6 relative mx-auto">
        {/* Error Banner */}
        {errorMsg && (
          <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg flex items-center justify-between gap-3">
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={handleRetry}
              className="text-xs font-bold uppercase tracking-wider text-red-800 hover:text-red-950 px-2 py-1 bg-red-100 hover:bg-red-200 rounded transition-colors focus:outline-none focus:ring-1 focus:ring-red-500"
            >
              Retry
            </button>
          </div>
        )}

        {/* Phase 1: Selector */}
        {step === 'select' && (
          <div className="flex flex-col gap-6">
            {!showPicker ? (
              <QrPanel onScan={handleZoneSelected} onError={handlePickerError} onShowPicker={() => setShowPicker(true)} />
            ) : (
              <>
                <BlockPicker onSelect={handleZoneSelected} onError={handlePickerError} />
                <div className="text-center mt-2">
                  <button
                    type="button"
                    onClick={() => setShowPicker(false)}
                    className="text-sm font-semibold text-accent hover:underline focus:outline-none"
                  >
                    Scan QR code instead
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Phase 2: Confirmation Animation */}
        {step === 'confirming' && pendingZoneInfo && (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
            {/* Pulsing checkmark badge */}
            <motion.div
              initial={shouldReduceMotion ? { scale: 1, opacity: 1 } : { scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 300, damping: 20 }}
              className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-green-600"
            >
              <svg viewBox="0 0 24 24" className="w-8 h-8 stroke-current" fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </motion.div>

            <motion.div
              initial={shouldReduceMotion ? { y: 0, opacity: 1 } : { y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={shouldReduceMotion ? { duration: 0 } : { delay: 0.1, duration: 0.3 }}
              className="flex flex-col gap-1"
            >
              <h2 className="text-xl font-bold text-text-primary">
                You&apos;re in Section {pendingZoneInfo.label}
              </h2>
              <p className="text-sm text-text-secondary">
                {pendingZoneInfo.tier}
              </p>
            </motion.div>
          </div>
        )}

        {/* Phase 3: Ticket scan */}
        {step === 'ticket' && (
          <TicketScanCard
            onScanComplete={handleTicketScanned}
            onSkip={onComplete}
          />
        )}
      </div>
    </div>
  );
}
