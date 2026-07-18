# M21 — Mobile / Responsive Layout (Stretch Goal)

StadiumIQ is adapted for optimal phone and tablet screen widths. Since fans primarily access the application in a live stadium environment on their mobile devices, a highly responsive interface is essential for real-world utility.

---

## 1. Breakpoint & Device Reflows

- **Responsive Breakpoint**: We use the standard screen width threshold of **`768px`** (`md` / `lg` utility classes) consistently across all fan-facing components.
- **Top Bar & Active Location**: The active location and tier headers stack responsively above the map.
- **SVG Map Scaling**: The digital twin `<StadiumMap>` scales down dynamically matching the container widths without clipping text or section bounds.
- **Alert & Incentive Cards**: Dismissible alert lists reflow to full-screen width margins (`left-4 right-4`) on mobile devices, ensuring zero boundary overflows.

---

## 2. Bottom Sheet Structural Design

A pure CSS block-to-hidden reflow is insufficient for the `AssistantPanel` because desktop and mobile layouts require distinct user interaction patterns:
- **Desktop**: The assistant functions as a static side column alongside the map, allowing side-by-side scanning.
- **Mobile**: Multi-column layouts lead to cramped viewports. The assistant is extracted into a slide-up sheet, maximizing map display space when closed.

### Implementation:
- **Trigger**: A persistent floating button (`data-testid="mobile-chat-trigger"`) featuring a chat icon slides into the bottom right corner of the screen.
- **Slide-up Animation**: Powered by `<AnimatePresence>` and `motion.div` from Framer Motion, sliding from `translateY(100%)` to `0` using responsive spring dynamics. It honors `prefers-reduced-motion` settings.
- **Overlay Backdrop**: A translucent backdrop renders behind the sheet to dismiss the drawer when clicked outside.
- **Header Dismiss**: An inline dismiss button (`X` icon) is overlayed on top of the assistant's header.

---

## 3. Map Icon-Overlay Alignment Verification

To prevent icon displacement bugs when resizing:
- **Aspect Ratio Locking**: The absolute HTML POI overlay container mirrors the exact aspect ratio of the SVG viewport (`aspect-[680/396]`) and utilizes matching relative bounds.
- **RTL Integration Testing**: Viewport testing verifies that SVG viewBox markers, paths, and HTML pins remain aligned at a mobile width of `320px` without horizontal displacement.
