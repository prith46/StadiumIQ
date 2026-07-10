"use client"

import * as React from "react"
import { motion, useReducedMotion } from "framer-motion"
import { useRoleStore } from "@/lib/store/roleStore"
import { springTransition, instantTransition } from "@/lib/motion/transitions"

const ROLES = [
  { value: "fan", label: "Fan" },
  { value: "organizer", label: "Organizer" },
] as const

export function RoleToggle() {
  const role = useRoleStore((s) => s.role)
  const setRole = useRoleStore((s) => s.setRole)
  const shouldReduceMotion = useReducedMotion()

  const highlightTransition = shouldReduceMotion ? instantTransition : springTransition

  // WAI-ARIA radiogroup keyboard pattern: arrow keys move selection and focus
  // across the radios (roving tabindex handles the Tab-stop behaviour).
  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return
    e.preventDefault()
    const currentIndex = ROLES.findIndex((r) => r.value === role)
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1
    const next = ROLES[(currentIndex + delta + ROLES.length) % ROLES.length]
    setRole(next.value)
    e.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-role="${next.value}"]`)
      ?.focus()
  }

  return (
    <div
      className="relative flex items-center p-1 bg-track rounded-pill border border-border"
      role="radiogroup"
      aria-label="Select role: Fan or Organizer"
    >
      {ROLES.map((option) => {
        const selected = role === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            data-role={option.value}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setRole(option.value)}
            onKeyDown={handleKeyDown}
            className={`relative z-10 px-4 py-1.5 text-xs font-semibold rounded-pill transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              selected ? "text-inverse" : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {selected && (
              <motion.div
                layoutId="active-role-bg"
                className="absolute inset-0 bg-accent rounded-pill -z-10"
                transition={highlightTransition}
              />
            )}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
