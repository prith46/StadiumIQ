"use client";

import React, { useState, useRef } from "react";
import { TicketData } from "../../lib/types";
import { useSimStore } from "../../lib/store/simStore";

interface TicketScanCardProps {
  onScanComplete: (ticket: TicketData) => void;
  onSkip: () => void;
}

// 1x1 transparent PNG base64 for simulating upload
const MOCK_IMAGE_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

const MOCK_TICKETS = [
  { section: "sec-214", gate: "gate-b", nationality: "Brazil", countryCode: "BR", seat: "14" },
  { section: "sec-108", gate: "gate-a", nationality: "France", countryCode: "FR", seat: "22" },
  { section: "sec-305", gate: "gate-d", nationality: "Japan", countryCode: "JP", seat: "7" },
];

export function TicketScanCard({ onScanComplete, onSkip }: TicketScanCardProps) {
  const setFanLanguage = useSimStore((s) => s.setFanLanguage);
  const fanContext = useSimStore((s) => s.fanContext);

  const [scanning, setScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mockIndex, setMockIndex] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const processImage = async (base64Data: string) => {
    setScanning(true);
    setErrorMsg(null);

    try {
      const response = await fetch("/api/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64Data,
          mimeType: "image/png",
          fanContext: fanContext,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to scan ticket. Please try again or select language manually.");
      }

      const result = await response.json();

      if (result.meta?.tool === "vision-unavailable" || result.error) {
        throw new Error(result.message || "Could not read ticket code.");
      }

      // Automatically set the language and complete
      if (result.language) {
        setFanLanguage(result.language);
      }

      // Fallback ticket fields if not fully parsed
      const ticket: TicketData = result.ticket || MOCK_TICKETS[mockIndex % MOCK_TICKETS.length];
      setMockIndex((prev) => prev + 1);

      onScanComplete(ticket);
    } catch (err) {
      console.error(err);
      setErrorMsg(
        err instanceof Error && err.message
          ? err.message
          : "Failed to scan ticket. Please use the language picker or skip."
      );
    } finally {
      setScanning(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setErrorMsg("Image size exceeds 5MB limit.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data:image/...;base64, prefix
      const base64Data = result.split(",")[1];
      processImage(base64Data);
    };
    reader.onerror = () => {
      setErrorMsg("Failed to read image file.");
    };
    reader.readAsDataURL(file);
  };

  const handleSimulateScan = () => {
    processImage(MOCK_IMAGE_BASE64);
  };

  return (
    <div className="flex flex-col items-center gap-6 w-full text-center">
      <div>
        <h2 className="text-lg font-bold text-text-primary">Personalize Your Experience</h2>
        <p className="text-sm text-text-secondary mt-1">
          Scan or upload your matchday ticket to sync language preferences, navigation paths, and seat directions.
        </p>
      </div>

      {errorMsg && (
        <div className="w-full p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg text-left">
          {errorMsg}
        </div>
      )}

      {/* Ticket graphic or placeholder */}
      <div className="w-full max-w-[280px] h-[140px] border border-dashed border-border rounded-xl bg-canvas flex items-center justify-center relative overflow-hidden">
        {scanning ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-8 h-8 border-4 border-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs font-semibold text-accent animate-pulse">Reading ticket code...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 p-4 text-text-secondary/70">
            <svg viewBox="0 0 24 24" className="w-8 h-8 stroke-current" fill="none" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 9V5a2 2 0 012-2h16a2 2 0 012 2v4M2 15v4a2 2 0 002 2h16a2 2 0 002-2v-4" />
              <path d="M2 9a3 3 0 013 3 3 3 0 01-3 3M22 9a3 3 0 00-3 3 3 3 0 003 3" />
              <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="3 3" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider">Ticket Upload</span>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
        aria-label="Upload ticket image"
      />

      <div className="w-full max-w-xs flex flex-col gap-2">
        <button
          type="button"
          onClick={handleSimulateScan}
          disabled={scanning}
          className="w-full py-2.5 px-4 bg-accent hover:bg-accent/95 disabled:bg-accent/50 text-white font-semibold rounded-lg shadow-sm transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
        >
          {scanning ? "Scanning..." : "Scan Match Ticket"}
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={scanning}
          className="w-full py-2.5 px-4 bg-transparent border border-border hover:bg-canvas/50 text-text-primary font-semibold rounded-lg transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
        >
          Upload Ticket Photo
        </button>

        <button
          type="button"
          onClick={onSkip}
          disabled={scanning}
          className="w-full py-2.5 px-4 bg-transparent hover:bg-canvas/50 text-text-secondary font-semibold rounded-lg transition-colors text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
        >
          Skip, I&apos;ll do this later
        </button>
      </div>
    </div>
  );
}
