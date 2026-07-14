# StadiumIQ — Technical Master Reference Documentation

This document serves as the comprehensive technical reference for the **StadiumIQ** digital twin and crowd-aware navigation application. It consolidates the architecture, data models, design patterns, algorithms, and integration specifications for the F1–F4 foundation layers and the Tier 1/2 modules (M1–M9) completed to date.

**Generation Date**: July 10, 2026  
**Target Audience**: Software Engineers, System Architects, QA Engineers, and Technical Leads.

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Foundations (F1–F4)](#2-foundations-f1-f4)
   - [F1: Design System & App Shell](#f1-design-system--app-shell)
   - [F2: Venue Graph & Data Model](#f2-venue-graph--data-model)
   - [F3: Simulation Engine](#f3-simulation-engine)
   - [F4: Provider-Agnostic AI Layer](#f4-provider-agnostic-ai-layer)
3. [Module Reference (In Build Order)](#3-module-reference-in-build-order)
   - [M4: Interactive Stadium Map & Live Heatmap](#m4-interactive-stadium-map--live-heatmap)
   - [M1: QR Location Onboarding](#m1-qr-onboarding-location-onboarding)
   - [M2: Conversational AI Assistant](#m2-conversational-ai-assistant)
   - [M3: Reasoned Crowd-Aware Navigation Engine](#m3-reasoned-crowd-aware-navigation-engine)
   - [M5: Dynamic Map Highlighting & Overlay Pipeline](#m5-dynamic-map-highlighting--overlay-pipeline)
   - [M6: Proactive Smart-Exit Alerts](#m6-proactive-smart-exit-alerts)
   - [M7: Predictive Crowd Forecasting](#m7-predictive-crowd-forecasting)
   - [M8: Anti-Herding Load-Balancer](#m8-anti-herding-load-balancer)
   - [M9: Smart Bribe Incentives](#m9-smart-bribe-incentives)
4. [Cross-Module Dependency Map](#4-cross-module-dependency-map)
5. [Running Test Suite Summary](#5-running-test-suite-summary)
6. [Appendix — Consolidated Deviation Log](#6-appendix--consolidated-deviation-log)

---

## 1. Architecture Overview

StadiumIQ is architected around several cross-cutting visual, technical, and operational invariants that apply across all modules:

* **AI-vs-Logic Separation**: Large Language Models (LLMs) are strictly prohibited from generating mathematical models, paths, lists, or forecasts. Instead, pure deterministic TypeScript engines calculate all routes, ETAs, and predictions. The LLM acts solely as a natural language interface, translating structured JSON outputs (e.g. `RouteResult` or `ForecastResult`) into human phrasing without hallucinating numerical metrics.
* **Pure Engine vs. Service Layer Pattern**: System business logic is structured into two cleanly separated tiers:
  * **Pure Engines (`lib/engine/*.ts`)**: Synchronous, side-effect-free, environment-independent functions. They import only basic types and standard libraries (no React, Zustand, or network imports), making them fully testable in isolation.
  * **Service Layers (`*Service.ts`)**: Stateful connectors that read inputs reactively from Zustand stores (like `useSimStore` or `useAlertStore`) and delegate routing, triage, or forecasting calls to the pure engines.
* **Simulation Clock Synchronization**: The application relies on a deterministic digital-twin simulation clock (`matchClockSec` in `useSimStore`), running from `-1800` (pre-match arrival) to `8100` (post-match egress). To prevent timing drift, all countdowns, cooldowns, and active alerts are evaluated relative to `matchClockSec` rather than using browser `Date.now()` or `setInterval`.
* **Single Dispatch Map Action Pipeline**: Map mutations (outlines, path-drawing, incident pins) route through the asynchronous dispatcher in `lib/assistant/mapActionDispatcher.ts`. This acts as the single entry point interfacing with the imperative map ref handlers, executing operations inside try-catch scopes to shield the application from invalid inputs.
* **Visual Animation Timing**: Entrance and exit transitions utilize centralized parameters. Exit animations default to `EXIT_FADE_MS = 200` (defined in `overlayAnimations.ts`) and are mapped to standard CSS transitions. A unified accessibility controller overrides all entrance and exit transitions to `0ms` when a user's system preferences match `prefers-reduced-motion`.
* **QR Security & Payload Validation**: To prevent buffer overflow and parser exploits, all QR scan and click actions undergo size-limit validation (maximum `500 bytes`) and JSON schema verification prior to parsing.

---

## 2. Foundations (F1–F4)

### F1: Design System & App Shell
* **Purpose**: Establishes the layout boundaries, typography, colors, visual tokens, and assistive accessibility state variables.
* **Key Design Tokens**:
  * **HSL Heatmap Palette**: Interpolates section crowdedness from HSL 84.88° (Green/Clear: `#C0DD97`) to HSL 36.99° (Amber/Busy: `#FAC775`) up to HSL 0.0° (Red/Crowded: `#F09595`).
  * **Base Theme**: FIFA-Blue primary accent (`#2563EB`), surface canvas (`#FAFAFA`), card radiuses (`12px`), control radiuses (`8px`), and standard elevation shadows.
* **Component Inventory**:
  * `AppShell`: Global header, role toggle wrapper, and grid boundaries.
  * `RoleToggle`: Segmented sliding pill selector driving the Fan/Organizer role toggle.
  * `A11yControls`: Switch panel toggling High Contrast, Text-to-Speech (TTS), and Font Scaling.
  * Primitives: Button, Card, Dialog, Skeleton, and a hand-authored, dependency-free `Toast` viewport system.
* **How to Extend**: Any token additions must be declared in three locations to guarantee Tailwind resolution at build time:
  1. `lib/theme/tokens.ts` (TypeScript mapping).
  2. `app/globals.css` (CSS variables inside `:root`).
  3. `tailwind.config.ts` (Tailwind theme configuration).
* **Limitations**: Permanently light-mode only. TTS controls are currently stubs (state variables only) pending M13 integration.

### F2: Venue Graph & Data Model
* **Purpose**: Defines the physical structural layout, connectivity edges, and static POIs of the venue (MetLife Stadium, East Rutherford, NJ).
* **Coordinate & Angle System**: SVG coordinate circles with South at $90^\circ$, West at $180^\circ$, North at $270^\circ$, and East at $0^\circ$/$360^\circ$. Degrees increment clockwise.
* **Physical Ring Radial Bounds**:
  * *Field Pitch*: $r = 0 \text{px}$ to $105 \text{px}$.
  * *Tier 1 (Lower Seating)*: $r = 120 \text{px}$ to $195 \text{px}$ (16 sections, $22.5^\circ$ angular width).
  * *Tier 2 (Mid Seating)*: $r = 210 \text{px}$ to $280 \text{px}$ (20 sections, $18^\circ$ angular width).
  * *Tier 3 (Upper Seating)*: $r = 295 \text{px}$ to $370 \text{px}$ (24 sections, $15^\circ$ angular width).
  * *Concourse Walkways*: Narrow rings situated at the outer boundaries of each tier.
  * *Gates*: Located at $200 \text{px}$ to $210 \text{px}$ radial bounds at cardinal angles (A: North, B: East, C: South, D: West).
* **Walk-Time Cost Weights**:
  * Concourse-to-Gate connections: $75 \text{ seconds}$.
  * Stairs (vertical transit): $65\text{s} - 85\text{s}$ (marked inaccessible).
  * Elevators (vertical transit): $105\text{s} - 130\text{s}$ (fully accessible).
* **Layout Quadrants**: Northeast holds `transit-train` ($315^\circ$), Southeast holds `transit-bus` ($45^\circ$), Northwest holds `transit-taxi` ($225^\circ$), and Southwest holds `transit-parking` ($135^\circ$).

### F3: Simulation Engine
* **Purpose**: Client-side, in-memory digital twin generating real-time crowd dynamics, incident states, and sensor feedback.
* **Tick Parameters**: Evaluates transitions every $2000 \text{ ms}$ of real-world time, advancing the match clock by $45 \text{ simulation seconds}$ per tick.
* **Core Match Phases**:
  * `pre` ($<0\text{s}$): Crowd densities in seating sections go $0.0 \rightarrow 0.6$; concourses spike $0.0 \rightarrow 0.5$.
  * `firstHalf` ($0\text{s} \rightarrow 2700\text{s}$): Seating sections climb $0.6 \rightarrow 0.9$ (held at 0.9); concourses empty to $0.15$.
  * `half` ($2700\text{s} \rightarrow 3600\text{s}$): Seating sections empty $0.9 \rightarrow 0.3$; concourses spike up to $0.9$.
  * `secondHalf` ($3600\text{s} \rightarrow 6300\text{s}$): Seating sections climb back to $0.9$; concourses empty back to $0.15$.
  * `fullTime` ($6300\text{s} \rightarrow 8100\text{s}$): Seating sections empty down to $0.05$; concourses/gates experience massive egress spike (climbing to $0.95$ in first 40%, then decaying linearly).
* **Stable Jitter Generator**: Uses a deterministic `mulberry32` PRNG seeded with `hashZoneId(zoneId) ^ seed`, ensuring stable per-zone density offsets.
* **Cross-Tab Sync**: Synchronizes multiple tabs via `BroadcastChannel('stadiumiq')`. Messages (`STATE_SYNC`, `HEARTBEAT`, `SCENARIO`, `RESET`, `IMPORT`) are filtered and merged. Heartbeats are pruned when inactive for more than `SESSION_TTL_MS = 10000` (10s).
* **Density Sensor Blending**:
  $$\text{influence} = \min\left(1, \frac{\text{sensorCount}}{8}\right)$$
  $$\text{density} = \text{clamp01}\left(\text{baseDensity} \times 0.7 + \text{influence} \times 0.3\right)$$

### F4: Provider-Agnostic AI Layer
* **Purpose**: Configures adapters for Gemini/Groq APIs, sanitizes natural language prompts, and handles fallback errors.
* **Environment Configuration**: Evaluated into a cached `AI_ENV` Proxy via Zod schemas, checking `LLM_PROVIDER`, `LLM_MODEL`, `LLM_API_KEY`, and `LLM_TIMEOUT_MS` (default: 8000ms).
* **Prompt Injection Defense**:
  * Delimiters: Wrap user input inside `<user_message>` and `</user_message>` system-level tags.
  * Sanitization: Text containing these delimiters is stripped case-insensitively via `/<\/?user_message>/gi` and replaced with `[filtered]` prior to prompt compile.
* **RAG-Lite In-Memory Retrieval**: Parses `data/knowledge.md` into markdown section chunks, ranks matching chunks based on keyword token overlaps, and resolves score ties deterministically using the original document index order.
* **Outage Resilience**: Runs an automatic **exactly-once retry** on failures, aborts hangs after 15s via `AbortController`, and returns a safe, localized JSON `FALLBACK_RESPONSE` during downstream API errors.

---

## 3. Module Reference (In Build Order)

### M4: Interactive Stadium Map & Live Heatmap
* **Purpose**: SVG rendering engine driving the MetLife layout, clickable zone event handles, and live heatmap color interpolation.
* **Props interface**: `StadiumMapProps` exposing `mode: 'fan' | 'organizer'`, `currentZoneId`, `onZoneClick`, and `onPoiClick`.
* **Ref methods**: `StadiumMapHandle` exposing `highlightZone()`, `drawRoute()`, `dropPin()`, and `clearOverlay()`.
* **Heatmap color interpolation formula**:
  Let HSL stops be Green (`hsl(84.88, 50.73%, 72.94%)`), Amber (`hsl(36.99, 93.01%, 71.96%)`), and Red (`hsl(0, 75.22%, 76.28%)`).
  For $d < 0.5$, let $t = 2d$:
  $$H = 84.878 - 47.884 \cdot t$$
  $$S = 50.725 + 42.286 \cdot t$$
  $$L = 72.941 - 0.980 \cdot t$$
  For $d \ge 0.5$, let $t = 2d - 1$:
  $$H = 36.994 - 36.994 \cdot t$$
  $$S = 93.011 - 17.795 \cdot t$$
  $$L = 71.961 + 4.314 \cdot t$$
* **Accessibility Fallback**: Bypasses browser-level SVG tab-index inconsistencies by rendering a visually hidden list of HTML `<button>` elements matching all clickable nodes, ensuring screen readers can focus, activate, and read localized `aria-label` tags.
* **Source Path**: `components/StadiumMap.tsx`
* **Test Coverage**: `tests/StadiumMap.test.tsx` (14 tests)

### M1: QR Onboarding (Location Onboarding)
* **Purpose**: Direct-boarding workflow for setting the active section coordinate and loading matching ticket metadata.
* **QR Specs**: Enforces a strict 500-byte raw string cap. Parses payload into version (`v === 1`) and type (`type === 'seat-block'`) before looking up the target zone in the database.
* **Single Path Rule**: Both the QR scanner and manual selection grid parse their inputs through `parseQrPayload` before updating `FanContext.location` to shield the store from malformed IDs.
* **Ticket Simulation Rotation**: Cycles through Brazil (`sec-214`, `gate-b`), France (`sec-108`, `gate-a`), and Japan (`sec-305`, `gate-d`) upon simulated ticket scans.
* **Re-onboarding**: Click to trigger `setIsOnboardingOverride(true)` to reveal the selection modal overlay without clearing the fan's active position.
* **Source Path**: `lib/onboarding/qr.ts` and `components/onboarding/OnboardingScreen.tsx`
* **Test Coverage**: `tests/onboarding/OnboardingScreen.test.tsx` (7 tests), `lib/onboarding/qr.test.ts` (7 tests)

### M2: Conversational AI Assistant
* **Purpose**: Persistent assistant sidebar parsing fan questions, dispatching map actions, and managing streaming.
* **Connection Client**: Single choke point `lib/assistant/client.ts`. Compiles `fanContext` and `simSnapshot` from Zustand stores before dispatching requests to `/api/assistant`.
* **Streaming Decoder**: Parses incoming `text/event-stream` chunk-by-chunk using `onToken` for character-by-character printing, resolving full JSON parameters inside `onComplete`.
* **Security Controls**: Uses custom markdown regex replacements for bolding/italics, completely avoiding React `dangerouslySetInnerHTML` vulnerabilities. Direct model identifier strings are prohibited from appearing in source code and test files, checked dynamically at test time.
* **Source Path**: `components/assistant/AssistantPanel.tsx`
* **Test Coverage**: `tests/assistant/AssistantPanel.test.tsx` (7 tests), `lib/assistant/client.test.ts` (6 tests)

### M3: Reasoned Crowd-Aware Navigation Engine
* **Purpose**: pure graph Dijkstra navigation computing least-congested route with ETA and avoided gates.
* **Congestion formula**:
  $$\text{weight} = \text{baseWalkSec} \times \left(1 + 2.5 \times d + 0.15 \times \min(\text{load}, 10)\right)$$
* **Routing multipliers**: Congested gates receive a $4\times$ weight penalty, soft filters (avoidEnclosed, maxNoise, avoidAffiliation) add a $3\times$ penalty, and closed gates are hard-excluded.
* **State updates**: Service wrapper calls `incrementRoutedLoad(gateId)` exactly once on success to increment herding counts.
* **Source Path**: `lib/engine/routing.ts`, `lib/engine/destinationResolver.ts`, and `lib/engine/routingService.ts`
* **Test Coverage**: `lib/engine/routing.test.ts` (25 tests), `lib/engine/destinationResolver.test.ts` (11 tests), `lib/engine/routingService.test.ts` (4 tests)

### M5: Dynamic Map Highlighting & Overlay Pipeline
* **Purpose**: Async action sequencing and animations driving the map highlighting, routes drawing, and pin drops.
* **Overlay Animations**: Centralized spring configurations (entrance scale: 0.4s easeOut; pathLength route draw: `Math.min(0.6 + pathLength * 0.05, 1.2)`s; pin drop: stiffness 300, damping 15 with high-contrast white stroke halo outline).
* **Exit snapshot caching**: Outgoing overlays are cloned into a temporary state and faded out using linear CSS transitions over `EXIT_FADE_MS = 200`. Calling `clearOverlay` immediately clears active states synchronously to avoid unit testing timer delays.
* **Action Sequencing**: Route-Pin sequencing blocks the execution of `dropPin()` until `drawRoute()`'s returned Promise has resolved, while other action pairs dispatch concurrently.
* **Source Path**: `lib/assistant/mapActionDispatcher.ts` and `lib/venue/overlayAnimations.ts`
* **Test Coverage**: `lib/assistant/mapActionDispatcher.test.ts` (7 tests)

### M6: Proactive Smart-Exit Alerts
* **Purpose**: Spawns contextual navigation suggestions and safety warnings to a persistent card layout layer.
* **Alert Trigger rules**:
  * **Exit nudge** (`'exit-nudge'`): Triggers between `matchClockSec` $[5700, 6300]$. Recommends the clearest open exit if the nearest exit gate's density exceeds $0.7$. Priority 2.
  * **Transit nudge** (`'transit-nudge'`): Triggers if the fan flagged `leavingEarly = true` and the train departure buffer (trains depart MetLife every 15 mins / 900s since kickoff) falls under $300\text{ seconds}$. Priority 2.
  * **Halftime nudge** (`'halftime-nudge'`): Triggers between `matchClockSec` $[2700, 3600]$ to suggest visiting the nearest restroom POI if its adjacent concourse density is below $0.4$. Priority 3.
* **Cooldown and Cooldown Bypass**: Blocks identical triggers for $3\text{ minutes}$ ($180\text{ seconds}$). However, since the recommended target `zoneId` is bundled with the `alreadyFired` record inside `useAlertStore`, if the recommended destination changes (e.g. recommended gate switches from Gate A to Gate B), the cooldown is bypassed dynamically.
* **Source Path**: `lib/engine/alertTriage.ts` and `lib/engine/alertService.ts`
* **Test Coverage**: `lib/engine/alertTriage.test.ts` (11 tests)

### M7: Predictive Crowd Forecasting
* **Purpose**: Generates density forecasting and peak crush timelines.
* **Forecast Engine API**: `getForecast()`, `getPeakCrush()`, and `getForecastForAllZones()`. Supports `'timeline'` (active production timeline frame interpolation) and `'projection'` (base curve calculation) modes.
* **Linear Interpolation Formula**:
  $$\text{density}(t) = \text{density}(f_0) + (\text{density}(f_1) - \text{density}(f_0)) \times \frac{t - t_0}{t_1 - t_0}$$
* **Optimization Tradeoff**: Horizon scans in `getPeakCrush()` use $60\text{-second}$ steps, capturing all major peaks (due to 60s timeline intervals) while reducing computations by $98.3\%$ over a 60-minute window.
* **Tool Registration**: Exposes `getForecast` and `getPeakCrush` schemas to F4. Relative inputs clamp to $[0, 7200]$ simulation seconds.
* **Source Path**: `lib/engine/forecast.ts` (consumed by `lib/ai/tools.ts` and `app/api/copilot/route.ts`)
* **Test Coverage**: `lib/engine/forecast.test.ts` (12 tests)

### M8: Anti-Herding Load-Balancer
* **Purpose**: Prevents recommendation herding by distributing sequential routing requests.
* **Decay Rate**: Multiplies `routedLoad` values by $0.9$ per simulation tick (45s step size), yielding a half-life of:
  $$\text{half-life} = \frac{\ln(0.5)}{\ln(0.9)} \times 45 \approx 296\text{ seconds (~5 minutes)}$$
* **Reset Boundary Firewall**: Hard-resets the `routedLoad` map to `{}` on all match phase transitions to prevent old pre-match load records from biasing egress recommendations.
* **Gini Coefficient Formula**:
  $$\text{Gini} = \frac{\sum_{i=1}^n \sum_{j=1}^n |x_i - x_j|}{2 n \sum_{i=1}^n x_i}$$
* **Harness proof**: 20 sequential requests from the North stand yields a naive herding Gini coefficient of $0.75$, dropping to $0.15$ when load-balancing is active (improvement ratio of **$5.0$**, exceeding the $1.3$ target threshold).
* **Merit Bias Protection**: Capping the load term at $10$ ensures that a physical layout advantage (e.g. 10s vs 500s distance) is never overridden by routing penalties.
* **Source Path**: `lib/engine/loadBalance.ts`
* **Test Coverage**: `lib/engine/loadBalance.test.ts` (9 tests)

### M9: Smart Bribe Incentives
* **Purpose**: Offers time-limited coupons at open concession/merch POIs to steer fans away from emerging bottlenecks.
* **Bottleneck Signals**: Density $> 0.7$ at any concourse or gate, OR predictive load imbalance (routed load of an open gate is $> 1.5\times$ the mean gate load, minimum baseline gate load $\ge 2$).
* **Incentive Properties**: Tracks `expiresAt` based on simulated clock ticks. Card dims, CTA buttons disable, and the QR canvas displays an "Expired" overlay the instant clock passes `expiresAt`. Automatic card fade out occurs after a $10\text{-second}$ simulated grace period.
* **QR payload parameters**: Version (`v === 1`), type (`type === 'incentive'`), from, to, and reward description text under 500 bytes.
* **Rerouting Design**: Accepts coupon routing dynamically via `routingService.ts` at accept-time (Option A), guaranteeing that the path drawn reflects live, crowd-aware parameters.
* **Source Path**: `lib/engine/incentiveService.ts`, `lib/engine/incentiveTriage.ts`, and `components/incentives/IncentiveCard.tsx`
* **Test Coverage**: `lib/engine/incentiveTriage.test.ts` (7 tests), `lib/engine/incentiveService.test.ts` (4 tests), `tests/incentives/IncentiveStack.test.tsx` (5 tests)

---

## 4. Cross-Module Dependency Map

The following map illustrates the dependencies and reuse paths connecting the modules:

*   **F1 (Design System)** $\leftarrow$ Consumer of all UI elements (`AppShell`, components, and styles).
*   **F2 (Venue Graph)** $\leftarrow$ Ground truth graph definition consumed by **M4**, **M1**, **M3**, **M6**, **M7**, **M8**, and **M9**.
*   **F3 (Simulation Engine)** $\leftarrow$ Maintains global Zustand states. Consumed by **M4** (heatmap rendering), **M1** (location updates), **M2** (snapshot states), **M3** (live routing), **M6** (alert triggers), **M7** (forecasting timeline), **M8** (continuous tick decays and phase boundary resets), and **M9** (bottleneck signals).
*   **F4 (AI Layer)** $\leftarrow$ Drives the LLM chat tool groundings. Resolves queries utilizing **M3** (routing), **M7** (forecasts), and **M9** (incentives).
*   **M4 (Stadium Map)** $\leftarrow$ Layout canvas. Imperative ref methods are triggered by **M2** (assistant responses), **M5** (sequenced actions), **M6** (alert pathways), and **M9** (accept coupon redirects).
*   **M1 (QR Onboarding)** $\leftarrow$ Locks layout access until `FanContext.location` is set, seeding the location coordinate.
*   **M2 (AI Assistant)** $\leftarrow$ Primary user search interface. Interacts with **M5** to dispatch map overlays.
*   **M3 (Routing Engine)** $\leftarrow$ Graph Dijkstra engine. Invoked by **F4** tools, **M5** (path-finding), **M6** (exit nudge calculation), **M8** (congestion weighting), and **M9** (incentive routing).
*   **M5 (Map Overlays)** $\leftarrow$ Sequences map overlays and route-drawing. Triggered by **M2** assistant, **M6** alerts, and **M9** accept clicks.
*   **M6 (Proactive Alerts)** $\leftarrow$ Floats proactive warning cards. Uses **M3** for routing computations and **M5** for path drawing.
*   **M7 (Crowd Forecasting)** $\leftarrow$ Computes forecasts. Seeds **F4** tool parameters.
*   **M8 (Anti-Herding)** $\leftarrow$ Injects load-balancing and herding penalties. Extends **M3**'s congestion routing weights.
*   **M9 (Smart Bribes)** $\leftarrow$ Spawns concession coupons. Leverages **M6** and **M8** for bottleneck signals, **M3** for routing, and **M5** for map overlay updates.

---

## 5. Running Test Suite Summary

* **Total Cumulative Unit Tests**: **224 tests**
* **Test Files Count**: 29 test files
* **Build Compilation Status**: Success (TypeScript compiled, ESLint valid, and static HTML pages generated).

---

## 6. Appendix — Consolidated Deviation Log

The following represent the resolved deviations from the original master plan specification implemented during development:

1.  **M3 Engine Destination Pre-Resolution (Deviation 1)**:
    *   *Spec Plan*: `computeRoute` takes a raw union `DestinationQuery`.
    *   *Implementation*: `computeRoute` accepts a pre-resolved destination zone ID string.
    *   *Rationale*: Decoupled POI catalog lookups from the pure routing math, placing resolver functions in `destinationResolver.ts` for clean separation and direct testability.
2.  **M3 AI Tool Legacy Support (Deviation 2)**:
    *   *Spec Plan*: AI tools query using `originZoneId`.
    *   *Implementation*: Evaluates both `originZoneId` and legacy alias `fromZoneId`.
    *   *Rationale*: Prevents breaking existing organizer-side AI test fixtures that relied on the pre-M3 stub structure.
3.  **M6 Cooldown Store Separation (Deviation 3)**:
    *   *Spec Plan*: Store proactive alert histories (`alreadyFired`) inside `useSimStore`.
    *   *Implementation*: Alerts history is stored inside a dedicated `useAlertStore`.
    *   *Rationale*: Prevents UI cooldown state variables from bloating simulation tab synchronization payloads.
4.  **M6 Dynamic Cooldown Bypass (Deviation 4)**:
    *   *Spec Plan*: Cooldown maps `triggerKey` directly to fire timestamp.
    *   *Implementation*: Bundles the recommended target `zoneId` inside the cooldown record.
    *   *Rationale*: Allows alert generation to bypass the 3-minute cooldown if the recommended alternative target gate changes.
5.  **M8 Herding Load Count Flat Mapping (Deviation 5)**:
    *   *Spec Plan*: Track herding history using timestamp lists.
    *   *Implementation*: Tracks history using a flat key-value load map (`Record<string, number>`) combined with tick-based exponential decays ($0.9$ factor per tick).
    *   *Rationale*: Optimizes JSON cross-tab serialization packet sizes.
6.  **M9 Accept Rerouting Choice (Deviation 6)**:
    *   *Spec Plan*: Direct static route calculations.
    *   *Implementation*: Dynamic rerouting at accept-time via the service layer `routingService.ts` (Option A).
    *   *Rationale*: Guarantees that the route drawn matches live crowd-aware parameters at the moment of acceptance, avoiding obsolete routes calculated minutes prior.
