"use client"

import * as React from "react"
import { useA11yStore } from "@/lib/store/a11yStore"

const ContrastIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3v18c4.97 0 9-4.03 9-9s-4.03-9-9-9z" fill="currentColor" />
  </svg>
)

const SpeakerIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
  </svg>
)

// Hoisted to module scope so the array identity is stable across renders.
const FONT_SCALES = [
  { value: 1, label: "A", text: "Normal text size" },
  { value: 1.15, label: "A+", text: "Large text size" },
  { value: 1.3, label: "A++", text: "Extra large text size" },
] as const

export function A11yControls() {
  const highContrast = useA11yStore((s) => s.highContrast)
  const fontScale = useA11yStore((s) => s.fontScale)
  const ttsEnabled = useA11yStore((s) => s.ttsEnabled)

  const toggleHighContrast = useA11yStore((s) => s.toggleHighContrast)
  const setFontScale = useA11yStore((s) => s.setFontScale)
  const toggleTts = useA11yStore((s) => s.toggleTts)

  // Declaratively reflect accessibility state onto the document root.
  // Side effects live here rather than in the store's setters.
  React.useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", highContrast)
  }, [highContrast])

  React.useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(fontScale))
  }, [fontScale])

  return (
    <div className="flex items-center gap-2" role="toolbar" aria-label="Accessibility Controls">
      {/* High Contrast Toggle */}
      <button
        type="button"
        aria-pressed={highContrast}
        aria-label="Toggle high contrast"
        onClick={toggleHighContrast}
        className={`p-2 rounded-control border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          highContrast
            ? "bg-text-primary text-inverse border-text-primary"
            : "bg-surface text-text-secondary border-border hover:bg-surface-hover hover:text-text-primary"
        }`}
      >
        <ContrastIcon />
      </button>

      {/* Font Scale Stepper */}
      <div className="flex items-center bg-surface border border-border rounded-control p-0.5" role="group" aria-label="Font scale adjustment">
        {FONT_SCALES.map((scale) => (
          <button
            key={scale.value}
            type="button"
            aria-pressed={fontScale === scale.value}
            aria-label={scale.text}
            onClick={() => setFontScale(scale.value)}
            className={`px-2.5 py-1 text-xs font-bold rounded-control transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              fontScale === scale.value
                ? "bg-accent text-inverse"
                : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            }`}
          >
            {scale.label}
          </button>
        ))}
      </div>

      {/* TTS Toggle */}
      <button
        type="button"
        aria-pressed={ttsEnabled}
        aria-label="Toggle text to speech"
        onClick={toggleTts}
        className={`p-2 rounded-control border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          ttsEnabled
            ? "bg-accent text-inverse border-accent"
            : "bg-surface text-text-secondary border-border hover:bg-surface-hover hover:text-text-primary"
        }`}
      >
        <SpeakerIcon />
      </button>
    </div>
  )
}
