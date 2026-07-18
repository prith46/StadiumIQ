# Module M5: Dynamic Map Highlighting & Overlay Pipeline

## Resolved Design Decision

To avoid flakiness in JSDOM-based unit testing while retaining a high-fidelity exit-fade animation for browser users, we resolved not to use Framer Motion's `AnimatePresence`. 
Instead:
- **Synchronous Primary State**: Calling `clearOverlay()` instantly resets the primary overlay states (`highlightedZone`, `route`, `pins`) to null, which guarantees that all functional testing assertions on overlay removals pass immediately and deterministically without timer delays.
- **Decorative Exit Snapshot**: Before clearing, the outgoing state is cloned into a short-lived `exitingSnapshot` component state. This snapshot is rendered in a fading `<g>` element with a plain CSS transition over `EXIT_FADE_MS` (200ms) and is cleaned up using a `setTimeout` callback.
- **Testing Stability**: Tests can assert immediate synchronous removal, and separately test the exit-fade snapshot removal using `vi.useFakeTimers()` to advance the clock.

- **Environment-Agnostic Timing Control (Dependency Injection)**: Rather than sniffing test environments (which is forbidden in production code), `components/StadiumMap.tsx` exposes an optional prop `onRouteAnimationStart?: (resolve: () => void) => void`. Under JSDOM testing conditions where animation frame events do not fire, tests pass this callback to immediately resolve the route drawing Promise. In production environments, this prop is omitted and the Promise resolves natively via Framer Motion's `onAnimationComplete` hook.

---

## 1. Animation Specifications & Easing Curves

All animation configurations are centralized in [overlayAnimations.ts](file:///e:/StadiumIQ/stadiumiq/lib/venue/overlayAnimations.ts) to guarantee consistent timing, curves, and ease of unit testing.

### Entrance Animations (Framer Motion)
- **Zone Highlight Entrance**: Scale pulse up from 1 to 1.05 then settle back to 1 over `0.4s` with `easeOut` easing. In organizer mode, the highlighted section is also filled with `rgba(37,99,235,0.08)` to give a premium glassmorphic overlay look.
- **Route Line Draw**: Uses the `pathLength` mount animation (`0` to `1`).
  - Longer routes draw progressively slower to look organic.
  - Duration formula: `Math.min(0.6 + pathLengthEstimate * 0.05, 1.2)` seconds.
  - Easing: `easeInOut` for smooth starts/stops.
  - A small blue arrow/circle marker drops onto the destination *only* after the drawing animation completes (`onAnimationComplete`).
- **Pins Drop**: Uses a spring-physics-based drop from above (`y: -20` to `0`) with a physical bounce.
  - Spring properties: `stiffness: 300`, `damping: 15`.
  - Contrast Halo: All pins maintain a high-contrast white halo outline (`stroke="white" strokeWidth="1.5"`) to guarantee visual legibility over any background section density color.

### Exit Animations (CSS Transitions)
- **Fade Out**: Outgoing overlays fade out linearly over `200ms`.
- **Prefers-Reduced-Motion Bypass**: When the media query matches, the entrance spring/pop/draw transitions are disabled, and the exit fade duration becomes `0ms` (instant removal).

---

## 2. Asynchronous Action Sequencing

In `mapActionDispatcher.ts`, `dispatchMapActions` has been refactored to be an asynchronous pipeline.

### Sequencing Rule
- When the batch of map actions contains a `{ op: 'route', path }` immediately followed by a `{ op: 'pin', zoneId }` at the terminal zone of the path, the dispatcher will:
  1. Trigger the async `drawRoute()` method.
  2. **Await** the route draw promise (which resolves when the `pathLength` animation completes).
  3. Trigger the `dropPin()` method only after the drawing has finished.
- For all other action pairs (e.g. highlight + pin in different areas), they execute concurrently without artificial blocking delays.

---

## 3. UI Thread Non-Blocking Requirement

The map actions are dispatched as fire-and-forget operations from the assistant's perspective. In `AssistantPanel.tsx`, `dispatchMapActions` is called without using the `await` keyword. This ensures that the chat UI thread remains responsive and does not freeze or block while the map animates.
