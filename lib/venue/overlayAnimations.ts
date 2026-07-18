/**
 * lib/venue/overlayAnimations.ts
 *
 * M5 — Pure animation configuration constants for the StadiumMap overlay layer.
 *
 * DESIGN RULE: These are module-level constants (never recreated per-render).
 * This file has NO React imports — it is pure config. Components import from
 * here to guarantee timing/easing constants are single-sourced and testable.
 *
 * EXIT FADE DECISION (resolved, not open):
 *   The exit-fade (clearOverlay) uses a plain CSS opacity transition on a
 *   short-lived `exitingOverlay` state variable, controlled via `setTimeout(EXIT_FADE_MS)`.
 *   AnimatePresence is NOT used for overlay-clear exit timing. This guarantees:
 *     - Primary overlay state is cleared synchronously (test-stable, never flaky).
 *     - The visual fade is fully deterministic with vi.useFakeTimers() in tests.
 *   See docs/STADIUMIQ-MASTER-DOCUMENTATION.md §4 (M5) for full rationale.
 */

import type { Transition, Variants } from 'framer-motion';

// ---------------------------------------------------------------------------
// Exit fade constant (used by both component and tests)
// ---------------------------------------------------------------------------

/**
 * Duration (ms) of the CSS opacity transition applied to the outgoing overlay
 * snapshot before it is unmounted. Controlled by setTimeout in the component,
 * controllable by vi.advanceTimersByTime(EXIT_FADE_MS) in tests.
 *
 * Set to 0 under `prefers-reduced-motion` (component reads the media query
 * and passes 0 instead when reduced-motion is active).
 */
export const EXIT_FADE_MS = 200;

// ---------------------------------------------------------------------------
// Highlight variants (highlightZone — mount animation)
// ---------------------------------------------------------------------------

/**
 * Framer Motion variants for zone highlighting.
 *
 * Sequence: initial → pulse (scale-up then back) → settled (persistent outline).
 * The CSS `animate-pulse` class on the same element handles the persistent
 * pulse loop and reduced-motion bypass (CSS `animation: none` in media query).
 * Framer Motion handles the entrance scale-pop (one-shot, not looping).
 */
export const highlightVariants: Variants = {
  initial: { scale: 1, opacity: 0 },
  pulse: {
    scale: [1, 1.05, 1],
    opacity: 1,
    transition: { duration: 0.4, ease: 'easeOut' },
  },
  settled: { scale: 1, opacity: 1 },
};

// ---------------------------------------------------------------------------
// Route draw transition (drawRoute — mount animation)
// ---------------------------------------------------------------------------

/**
 * Returns a Framer Motion transition config for a `pathLength` 0→1 animation.
 *
 * @param pathLengthEstimate  Number of segments in the path (path.length - 1).
 *   Longer paths draw slightly slower. Formula: clamp(0.6 + segments * 0.05, _, 1.2)s.
 *   Default for a 2-node path (1 segment): 0.65s.
 */
export function routeDrawTransition(pathLengthEstimate: number): Transition {
  const duration = Math.min(0.6 + pathLengthEstimate * 0.05, 1.2);
  return {
    pathLength: { duration, ease: 'easeInOut' },
    opacity: { duration: 0.2 },
  };
}

// ---------------------------------------------------------------------------
// Pin drop variants (dropPin — mount animation)
// ---------------------------------------------------------------------------

/**
 * Framer Motion variants for pin-drop entrance animation.
 * Spring bounce simulates a physical drop with overshoot then settle.
 * Color-coding (red/blue/gray) is handled by the component, not here.
 */
export const pinDropVariants: Variants = {
  initial: { y: -20, opacity: 0, scale: 0.8 },
  animate: {
    y: 0,
    opacity: 1,
    scale: 1,
    transition: { type: 'spring', stiffness: 300, damping: 15 },
  },
};
