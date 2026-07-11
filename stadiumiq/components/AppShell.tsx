"use client"

import * as React from "react"
import { motion, useReducedMotion } from "framer-motion"
import { RoleToggle } from "@/components/RoleToggle"
import { A11yControls } from "@/components/A11yControls"
import { fadeTransition } from "@/lib/motion/transitions"
import { useRoleStore } from "@/lib/store/roleStore"
import { useSimStore } from "@/lib/store/simStore"
import { ChangeSeatControl } from "@/components/onboarding/ChangeSeatControl"
import { SensoryPreferences } from "@/components/settings/SensoryPreferences"
import { LanguagePicker } from "@/components/LanguagePicker"

interface AppShellProps {
  children: React.ReactNode
}

const FADE_HIDDEN = { opacity: 0 } as const
const FADE_VISIBLE = { opacity: 1 } as const

// FIFA World Cup 2026 crest mark — the three host-nation stroke shapes over a pitch dot.
function BrandMark() {
  return (
    <span
      className="flex h-8 w-8 items-center justify-center rounded-control bg-accent text-inverse shadow-card"
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a10 10 0 100 20 10 10 0 000-20z" />
        <path d="M12 2v20M4 8h16M4 16h16" />
      </svg>
    </span>
  )
}

function SosHeaderButton() {
  const sos = useSimStore((s) => s.sos);
  const triggerSos = useSimStore((s) => s.triggerSos);
  const [confirmSos, setConfirmSos] = React.useState(false);
  const confirmTimeoutRef = React.useRef<any>(null);

  const handleSosClick = () => {
    if (confirmSos) {
      triggerSos("fan");
      setConfirmSos(false);
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    } else {
      setConfirmSos(true);
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmSos(false);
      }, 3000);
    }
  };

  React.useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current);
    };
  }, []);

  if (sos?.active) {
    return (
      <span className="px-3 py-1.5 rounded-control text-xs font-black bg-red-600 text-white animate-pulse shadow-md border border-red-500">
        SOS ACTIVE
      </span>
    );
  }

  return (
    <button
      onClick={handleSosClick}
      className={`px-3 py-1.5 rounded-control text-xs font-black transition-all cursor-pointer shadow-md ${
        confirmSos
          ? "bg-yellow-500 hover:bg-yellow-600 text-black animate-bounce"
          : "bg-red-600 hover:bg-red-700 text-white hover:scale-105 active:scale-95"
      }`}
    >
      {confirmSos ? "Confirm SOS?" : "SOS"}
    </button>
  );
}

export function AppShell({ children }: AppShellProps) {
  const shouldReduceMotion = useReducedMotion()
  const role = useRoleStore((s) => s.role)
  const location = useSimStore((s) => s.fanContext.location)
  const setIsOnboardingOverride = useSimStore((s) => s.setIsOnboardingOverride)

  return (
    <motion.div
      initial={shouldReduceMotion ? false : FADE_HIDDEN}
      animate={FADE_VISIBLE}
      transition={fadeTransition}
      className="min-h-screen flex flex-col bg-canvas font-sans antialiased selection:bg-accent/20"
    >
      <header className="sticky top-0 z-40 w-full border-b border-border bg-surface shadow-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Logo / Title Left */}
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <div className="flex flex-col leading-none">
              <span className="font-display text-lg font-bold tracking-tight text-text-primary">
                StadiumIQ
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary">
                World Cup 2026
              </span>
            </div>
          </div>

          {/* RoleToggle Center */}
          <div className="flex-1 flex justify-center">
            <RoleToggle />
          </div>

          {/* A11yControls Right */}
          <div className="flex items-center gap-4">
            {role === "fan" && (
              <SosHeaderButton />
            )}
            {role === "fan" && location && (
              <>
                <ChangeSeatControl onChangeSeat={() => setIsOnboardingOverride(true)} />
                <SensoryPreferences />
              </>
            )}
            <LanguagePicker />
            <A11yControls />
          </div>
        </div>
      </header>

      {/* Main Region */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </motion.div>
  )
}
