import { useSyncExternalStore } from 'react';

// Nothing ever changes after mount, so subscribers never need to re-fire.
const emptySubscribe = () => () => {};

/**
 * Returns false during SSR and the hydration render, true on every client
 * render after mount. `useSyncExternalStore` gives React the server/client
 * snapshot split natively, so no effect-driven `setMounted(true)` re-render
 * pass is needed (and the `react-hooks/set-state-in-effect` rule stays clean).
 *
 * Used by components whose output depends on browser-only state (localStorage,
 * viewport) that must not differ between the server render and hydration.
 */
export function useHasMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot: mounted
    () => false // server snapshot: not mounted
  );
}
