"use client"

import * as React from "react"
import { motion, useReducedMotion, AnimatePresence } from "framer-motion"
import { RoleToggle } from "@/components/RoleToggle"
import { Sliders } from "lucide-react"
import { A11yControls } from "@/components/A11yControls"
import { fadeTransition } from "@/lib/motion/transitions"
import { useRoleStore } from "@/lib/store/roleStore"
import { useSimStore } from "@/lib/store/simStore"
import { ZONES } from "@/lib/venue/venue"
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
  const confirmTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false)
  const [isMobile, setIsMobile] = React.useState(false)

  // `fanContext.location` is hydrated from localStorage synchronously when the
  // simStore module first evaluates in the browser — before React's first
  // client render — so it's already populated on that render, while SSR
  // always sees it as undefined (no `window`/localStorage server-side). Using
  // it directly in a conditional here made ChangeSeatControl/SensoryPreferences
  // appear/disappear between server and client output, shifting every sibling
  // after them (LanguagePicker) into a different DOM position and producing a
  // hydration mismatch. `hasMounted` starts false on both server and the first
  // client render (matching output exactly), then flips true in an effect —
  // which only runs post-hydration — so the location-dependent UI appears via
  // a normal client-side re-render instead of during hydration itself.
  const [hasMounted, setHasMounted] = React.useState(false)

  React.useEffect(() => {
    setHasMounted(true)
  }, [])

  // M29: kick off the automatic match sequencer once per app session — no
  // manual "Start" trigger. Guarded internally (module-level flag) against
  // double-invocation from React StrictMode's dev double-mount.
  React.useEffect(() => {
    useSimStore.getState().startAutoSequencer(ZONES)
  }, [])

  React.useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024)
    }
    handleResize()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  return (
    <motion.div
      initial={shouldReduceMotion ? false : FADE_HIDDEN}
      animate={FADE_VISIBLE}
      transition={fadeTransition}
      className="min-h-screen flex flex-col bg-canvas font-sans antialiased selection:bg-accent/20"
    >
      <header className="sticky top-0 z-40 w-full border-b border-border bg-surface shadow-card flex flex-col">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 w-full">
          {/* Logo / Title Left */}
          <div className="flex items-center gap-2.5 shrink-0">
            <BrandMark />
            <div className="hidden min-[400px]:flex flex-col leading-none">
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

          {/* Desktop Controls (hidden on mobile/tablet) */}
          {!isMobile && (
            <div className="flex items-center gap-4 shrink-0">
              {role === "fan" && (
                <SosHeaderButton />
              )}
              {hasMounted && role === "fan" && location && (
                <>
                  <ChangeSeatControl onChangeSeat={() => setIsOnboardingOverride(true)} />
                  <SensoryPreferences />
                </>
              )}
              <LanguagePicker />
              <A11yControls />
            </div>
          )}

          {/* Mobile Controls Toggle (visible on mobile/tablet) */}
          {isMobile && (
            <div className="flex items-center gap-2 shrink-0">
              {role === "fan" && (
                <SosHeaderButton />
              )}
              <button
                type="button"
                onClick={() => setIsSettingsOpen(!isSettingsOpen)}
                data-testid="header-settings-toggle"
                aria-expanded={isSettingsOpen}
                aria-label="Toggle settings menu"
                className={`p-2 rounded-control border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  isSettingsOpen
                    ? "bg-accent text-inverse border-accent"
                    : "bg-surface text-text-secondary border-border hover:bg-surface-hover hover:text-text-primary"
                }`}
              >
                <Sliders className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {/* Mobile Settings Dropdown */}
        <AnimatePresence>
          {isMobile && isSettingsOpen && (
            <motion.div
              initial={shouldReduceMotion ? { opacity: 1, height: "auto" } : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={shouldReduceMotion ? { opacity: 0, height: 0 } : { opacity: 0, height: 0 }}
              transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.2 }}
              className="border-t border-border bg-canvas overflow-hidden w-full"
              data-testid="header-settings-dropdown"
            >
              <div className="px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 max-w-7xl mx-auto w-full">
                <div className="flex flex-wrap items-center gap-3">
                  {hasMounted && role === "fan" && location && (
                    <>
                      <ChangeSeatControl onChangeSeat={() => {
                        setIsSettingsOpen(false)
                        setIsOnboardingOverride(true)
                      }} />
                      <SensoryPreferences />
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 border-t sm:border-t-0 border-border/50 pt-3 sm:pt-0">
                  <LanguagePicker />
                  <A11yControls />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Region */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>
    </motion.div>
  )
}
