"use client";

import * as React from "react";
import { useRoleStore } from "@/lib/store/roleStore";
import { useSimStore } from "@/lib/store/simStore";
import { StadiumMap, StadiumMapHandle } from "@/components/StadiumMap";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { OnboardingScreen } from "@/components/onboarding/OnboardingScreen";
import { AlertStack } from "@/components/alerts/AlertStack";
import { IncentiveStack } from "@/components/incentives/IncentiveStack";
import { ZONES } from "@/lib/venue/venue";
import { SOSOverlay } from "@/components/SOSOverlay";
import { Dashboard } from "@/components/organizer/Dashboard";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, X } from "lucide-react";

export default function HomePage() {
  const role = useRoleStore((s) => s.role);
  const location = useSimStore((s) => s.fanContext.location);
  const ticket = useSimStore((s) => s.fanContext.ticket);
  const isOnboardingOverride = useSimStore((s) => s.isOnboardingOverride);
  const setIsOnboardingOverride = useSimStore((s) => s.setIsOnboardingOverride);

  // Map Ref for assistant actions
  const mapRef = React.useRef<StadiumMapHandle | null>(null);

  // SOS state & handlers
  const sos = useSimStore((s) => s.sos);
  const triggerSos = useSimStore((s) => s.triggerSos);
  const clearSos = useSimStore((s) => s.clearSos);
  const [confirmOrganizerSos, setConfirmOrganizerSos] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);
  const [isBottomSheetOpen, setIsBottomSheetOpen] = React.useState(false);

  React.useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const organizerTimeoutRef = React.useRef<any>(null);

  const handleOrganizerSosClick = () => {
    if (confirmOrganizerSos) {
      triggerSos("organizer");
      setConfirmOrganizerSos(false);
      if (organizerTimeoutRef.current) clearTimeout(organizerTimeoutRef.current);
    } else {
      setConfirmOrganizerSos(true);
      organizerTimeoutRef.current = setTimeout(() => {
        setConfirmOrganizerSos(false);
      }, 3000);
    }
  };

  React.useEffect(() => {
    return () => {
      if (organizerTimeoutRef.current) clearTimeout(organizerTimeoutRef.current);
    };
  }, []);

  // Determine if we should show onboarding
  const showOnboarding = role === "fan" && (!location || isOnboardingOverride);

  if (showOnboarding) {
    return (
      <OnboardingScreen onComplete={() => setIsOnboardingOverride(false)} />
    );
  }

  if (role === "fan" && sos?.active) {
    return (
      <div className="w-full py-4">
        <SOSOverlay />
      </div>
    );
  }

  if (role === "fan") {
    // Fan View Layout
    const sectionLabel = location?.replace("sec-", "") || "";
    const gateLabel = ticket?.gate.replace("gate-", "").toUpperCase() || "";
    const activeZone = ZONES.find((z) => z.id === location);

    if (isMobile) {
      return (
        <div className="relative w-full px-4">
          <AlertStack mapRef={mapRef} />
          <IncentiveStack mapRef={mapRef} />
          
          <div className="flex flex-col gap-4 py-4 w-full max-w-md mx-auto">
            {/* Active Location Info (Compact) */}
            <div className="bg-surface p-4 rounded-xl border border-border shadow-card flex items-center justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Active Location</span>
                <h2 className="font-display text-lg font-extrabold text-text-primary">Section {sectionLabel}</h2>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider block">Stand / Tier</span>
                <span className="text-xs font-semibold text-text-primary uppercase">
                  {activeZone?.stand ? `${activeZone.stand} - ` : ""}
                  {activeZone?.tier === 1 ? "Lower" : activeZone?.tier === 2 ? "Mid" : "Upper"}
                </span>
              </div>
            </div>

            {/* Map Panel */}
            <div className="w-full bg-surface p-4 rounded-xl border border-border shadow-card flex items-center justify-center min-h-[350px]">
              <div className="w-full max-w-[450px] aspect-square">
                <StadiumMap ref={mapRef} mode="fan" currentZoneId={location} />
              </div>
            </div>
          </div>

          {/* Floating Chat Trigger Button */}
          <button
            onClick={() => setIsBottomSheetOpen(true)}
            data-testid="mobile-chat-trigger"
            className="fixed bottom-6 right-6 z-40 bg-accent hover:bg-accent/90 text-white p-4 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer flex items-center justify-center border border-accent/20"
            style={{ width: 56, height: 56 }}
            aria-label="Open Assistant"
          >
            <MessageSquare className="w-6 h-6" />
          </button>

          {/* Bottom Sheet under AnimatePresence */}
          <AnimatePresence>
            {isBottomSheetOpen && (
              <>
                {/* Overlay Backdrop */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setIsBottomSheetOpen(false)}
                  className="fixed inset-0 bg-black/40 z-50 cursor-pointer"
                  data-testid="mobile-sheet-backdrop"
                />
                {/* Bottom Sheet */}
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", damping: 25, stiffness: 250 }}
                  data-testid="mobile-assistant-sheet"
                  className="fixed bottom-0 left-0 right-0 bg-surface rounded-t-2xl border-t border-border shadow-2xl z-50 flex flex-col h-[75vh] overflow-hidden"
                >
                  {/* Drag handle line */}
                  <div
                    className="flex justify-center py-2 bg-canvas border-b border-border/40 cursor-pointer"
                    onClick={() => setIsBottomSheetOpen(false)}
                  >
                    <div className="w-12 h-1.5 bg-text-secondary/20 rounded-full" />
                  </div>
                  {/* Content */}
                  <div className="flex-1 relative min-h-0">
                    <AssistantPanel mapRef={mapRef} />
                    <button
                      onClick={() => setIsBottomSheetOpen(false)}
                      data-testid="mobile-sheet-close"
                      className="absolute top-2.5 right-3.5 p-1.5 hover:bg-black/10 rounded-lg text-white transition-colors cursor-pointer z-50"
                      aria-label="Close Assistant"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      );
    }

    return (
      <div className="relative w-full">
        <AlertStack mapRef={mapRef} />
        <IncentiveStack mapRef={mapRef} />
        <div className="flex flex-col lg:flex-row gap-6 items-stretch justify-center max-w-7xl mx-auto py-4 w-full">
        {/* Map Panel */}
        <div className="flex-1 w-full bg-surface p-6 rounded-xl border border-border shadow-card flex items-center justify-center min-h-[500px]">
          <div className="w-full max-w-[500px] aspect-square">
            <StadiumMap ref={mapRef} mode="fan" currentZoneId={location} />
          </div>
        </div>

        {/* Assistant & Info Panel */}
        <div className="w-full lg:w-[380px] flex flex-col gap-4 h-[650px] lg:h-auto shrink-0">
          {/* Active Location Info (Compact) */}
          <div className="bg-surface p-4 rounded-xl border border-border shadow-card flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] font-bold text-accent uppercase tracking-wider">Active Location</span>
              <h2 className="font-display text-lg font-extrabold text-text-primary">Section {sectionLabel}</h2>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider block">Stand / Tier</span>
              <span className="text-xs font-semibold text-text-primary uppercase">
                {activeZone?.stand ? `${activeZone.stand} - ` : ""}
                {activeZone?.tier === 1 ? "Lower" : activeZone?.tier === 2 ? "Mid" : "Upper"}
              </span>
            </div>
          </div>

          {/* Assistant Panel (occupies rest of height) */}
          <div className="flex-1 min-h-[400px]">
            <AssistantPanel mapRef={mapRef} />
          </div>
        </div>
      </div>
    </div>
    );
  }

  // Organizer View Layout
  // Organizer View Layout
  return (
    <Dashboard />
  );
}
