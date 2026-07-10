export const springTransition = {
  type: 'spring',
  stiffness: 300,
  damping: 30,
} as const;

export const fadeTransition = {
  duration: 0.2,
  ease: 'easeOut',
} as const;

// Zero-duration transition used when prefers-reduced-motion is active.
export const instantTransition = {
  type: 'tween',
  duration: 0,
} as const;
