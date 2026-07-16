/**
 * lib/assistant/mapActionDispatcher.ts
 *
 * M2/M5: Bridges AssistantResponse.mapActions[] to StadiumMapHandle ref methods.
 *
 * M5 additions:
 *   - clearOverlay() is called ONCE at the start of each dispatch batch (§6.2 fix).
 *   - Route→destination-pin sequencing: when a `route` action is immediately followed
 *     by a `pin` at the last zone of the path, the pin is delayed until drawRoute()'s
 *     returned Promise resolves (§6.3). All other action pairs dispatch concurrently.
 *   - dispatchMapActions is now async. Call sites use fire-and-forget (no await).
 */

import { ZONES } from '../venue/venue';

/**
 * Fix 7: the LLM's final-turn `mapActions` JSON schema (in `lib/ai/client.ts`)
 * doesn't constrain `zoneId`'s format the way the tool-calling schema in
 * `lib/ai/tools.ts` does (which explicitly documents "sections (sec-101)").
 * A bare id like "205" would silently no-op at `StadiumMap`'s
 * `ZONES.some(z => z.id === zoneId)` check. Normalize at this dispatch
 * boundary instead: accept either the correct prefixed id or a bare section
 * number and resolve to the real `Zone.id`, so a format slip from the LLM
 * doesn't silently drop the action.
 */
function normalizeZoneId(zoneId: string): string {
  if (ZONES.some((z) => z.id === zoneId)) return zoneId;
  const prefixed = `sec-${zoneId}`;
  if (ZONES.some((z) => z.id === prefixed)) return prefixed;
  return zoneId;
}

export interface MapAction {
  op: 'highlight' | 'route' | 'pin';
  zoneId?: string;
  path?: string[];
  kind?: 'incident' | 'dispatch' | 'poi';
}

/**
 * Aligned with StadiumMapHandle in components/StadiumMap.tsx.
 * M5: drawRoute now returns Promise<void> (for sequencing support).
 */
export interface StadiumMapHandle {
  highlightZone: (zoneId: string, opts?: { pulse?: boolean }) => void;
  drawRoute: (path: string[]) => Promise<void>;
  dropPin: (zoneId: string, kind: 'incident' | 'dispatch' | 'poi') => void;
  clearOverlay: () => void;
}

/**
 * Dispatch a batch of map actions to the StadiumMap ref handle.
 *
 * Sequencing rule (§6.3):
 *   When the batch contains `{ op: 'route', path }` immediately followed by
 *   `{ op: 'pin', zoneId: path[path.length - 1] }`, the pin is deferred until
 *   drawRoute()'s Promise resolves. All other actions dispatch without awaiting.
 *
 * Call sites MUST NOT await this function — it is fire-and-forget from the UI.
 */
export async function dispatchMapActions(
  actions: MapAction[],
  handle: StadiumMapHandle | null
): Promise<void> {
  if (!handle) {
    console.warn('[mapActionDispatcher] Map handle not wired, skipping actions:', actions);
    return;
  }

  // §6.2 fix: clear ONCE before the batch, not once per action
  handle.clearOverlay();

  // Pre-scan for the route→destination-pin pattern (§6.3)
  // Find the index of a 'route' action that is immediately followed by a 'pin'
  // at the route's terminal zone. Only this specific pair is sequenced.
  let routeActionIdx = -1;
  let routeTerminalZone: string | undefined;

  for (let i = 0; i < actions.length - 1; i++) {
    const cur = actions[i];
    const next = actions[i + 1];
    if (
      cur.op === 'route' &&
      Array.isArray(cur.path) &&
      cur.path.length > 0 &&
      next.op === 'pin' &&
      next.zoneId &&
      normalizeZoneId(next.zoneId) === normalizeZoneId(cur.path[cur.path.length - 1])
    ) {
      routeActionIdx = i;
      routeTerminalZone = normalizeZoneId(cur.path[cur.path.length - 1]);
      break;
    }
  }

  // Execute the batch
  let pendingRoutePromise: Promise<void> | null = null;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    try {
      if (action.op === 'highlight') {
        if (action.zoneId) {
          handle.highlightZone(normalizeZoneId(action.zoneId));
        } else {
          console.warn('[mapActionDispatcher] Highlight op ignored: missing zoneId');
        }
      } else if (action.op === 'route') {
        if (Array.isArray(action.path) && action.path.length > 0) {
          const promise = handle.drawRoute(action.path.map(normalizeZoneId));
          if (i === routeActionIdx) {
            // Store the promise so the following destination-pin can await it
            pendingRoutePromise = promise;
          }
        } else {
          console.warn('[mapActionDispatcher] Route op ignored: missing or empty path');
        }
      } else if (action.op === 'pin') {
        const kind = action.kind ?? 'incident';
        if (action.zoneId) {
          const normalizedZoneId = normalizeZoneId(action.zoneId);
          // If this is the destination pin following the sequenced route, await first
          if (
            pendingRoutePromise !== null &&
            normalizedZoneId === routeTerminalZone
          ) {
            await pendingRoutePromise;
            pendingRoutePromise = null;
          }
          handle.dropPin(normalizedZoneId, kind);
        } else {
          console.warn('[mapActionDispatcher] Pin op ignored: missing zoneId');
        }
      } else {
        console.warn(`[mapActionDispatcher] Unknown operation op: "${action.op}"`);
      }
    } catch (err) {
      console.error('[mapActionDispatcher] Failed to dispatch action:', action, err);
    }
  }
}
