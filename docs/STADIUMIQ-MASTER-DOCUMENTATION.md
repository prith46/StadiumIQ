# StadiumIQ — Master Documentation

Canonical technical reference. Every file path, function name, and count in this document was
verified against the working tree at the time of writing. Per-module deep dives live in the
sibling files in `docs/` (for example `docs/M3-routing.md`).

---

## 1. Product Summary

StadiumIQ is a GenAI assistant for FIFA World Cup 2026 stadium operations, built on a simulated
digital twin of MetLife Stadium. It runs entirely in the browser against a seeded crowd
simulation, with no database and no backend state.

The GenAI layer runs **Google `gemini-3.1-flash-lite`** (tool calling, native structured JSON
output, and vision for ticket scanning), configured through `.env` behind a provider-agnostic
adapter. See section 5.0.

**Personas**

| Persona | Surface | What they do |
|---|---|---|
| Fan | Fan view (`app/page.tsx`, role `fan`) | Scan a seat QR, ask the assistant for routes, amenities, forecasts, and policies; receive proactive alerts and detour incentives; trigger SOS. |
| Organizer | Organizer dashboard (`components/organizer/Dashboard.tsx`, role `organizer`) | Watch a live heatmap, read an AI risk brief and forecast, dispatch responders to incidents, run God Mode scenarios, upload judge datasets, generate a post-event debrief. |

**Core story.** A fan asks a question in their own language. The deterministic engine computes the
route, ETA, and forecast. The LLM only phrases the answer and drives the map. The same simulated
state is visible to the organizer in a second browser tab, kept in sync over `BroadcastChannel`.

The product name is StadiumIQ. MetLife Stadium is the venue being modeled.

---

## 2. System Architecture

### 2.1 Invariants as actually implemented

| Invariant | Where it holds | Verified detail |
|---|---|---|
| AI never computes routes, ETAs, forecasts, dispatch, or load balancing | `lib/ai/tools.ts` | Every tool delegates to a pure engine function (`computeRoute`, `resolveDestination`, `getForecast`, `getPeakCrush`). The LLM receives computed numbers and phrases them. |
| LLM narrates, never invents numbers | `lib/ai/copilot.ts:158-165` | `getForecastBrief` computes `findPeakCrush` / `forecastAt` first, then instructs the model it is "strictly forbidden from inventing or changing any numbers". |
| Provider and model come from `.env` only | `lib/ai/env.ts`, `lib/ai/client.ts` | `AI_ENV.LLM_PROVIDER` / `AI_ENV.LLM_MODEL` are read via a zod-validated proxy. No model id literal exists in `lib/`, `app/`, or `components/`. A guard test enforces this (`tests/ai/client.test.ts`, describe `provider-agnostic invariant`). |
| Key stays server-side | `app/api/*/route.ts` | All provider calls happen in route handlers. The key travels in a request header (`x-goog-api-key` / `Authorization`), never in a URL or the client bundle. |
| No database | whole repo | State lives in Zustand stores under `lib/store/`. Cross-tab sync is `BroadcastChannel` (`lib/simulation/channel.ts`). The only persisted client value is the fan location in `localStorage` (`components/AppShell.tsx`). |
| Single source of truth for the venue | `lib/venue/venue.ts` | `ZONES`, `EDGES`, `POIS` drive both the SVG map (`components/StadiumMap.tsx`) and all routing (`lib/engine/routing.ts`). |
| Structured LLM output contract | `lib/ai/agents.ts:20-33` | `assistantResponseSchema` (zod) parses `{ message, language, mapActions[], alertLevel, meta? }`. Enforced at parse time, with a salvage path (`buildLenientFallback`). |

### 2.2 Data flow

```
Fan tab                                   Organizer tab
--------                                  -------------
OnboardingScreen -> simStore.setFanLocation
AssistantPanel                            Dashboard / Copilot / DispatchQueue
   |                                          |
   v                                          v
lib/assistant/client.ts                   fetch /api/copilot, /api/debrief
   | POST /api/assistant                      |
   v                                          v
app/api/assistant/route.ts  ------------> lib/ai/* (server only, holds the key)
   | runFanAssistant -> tools -> lib/engine/* (pure)
   v
AssistantResponse { message, language, mapActions[], alertLevel, meta }
   |
   +-> MessageList (text)
   +-> mapActionDispatcher -> StadiumMapHandle (highlight / route / pin)

           both tabs
           ---------
        lib/store/simStore.ts  <--->  lib/simulation/channel.ts (BroadcastChannel "stadiumiq")
        messages: HEARTBEAT | SCENARIO | RESET | IMPORT | sos_trigger | sos_clear | SEQUENCER_INIT
```

The API layer is stateless. When a server-side tool creates an incident (`reportIncident`), it is
returned on `meta.reportedIncident` and applied to the browser store by `AssistantPanel`, because
the server process cannot reach the client's Zustand store.

### 2.3 Directory structure

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router. `page.tsx` (role-gated fan/organizer view), `layout.tsx`, `globals.css`, and five API route handlers. |
| `app/api/` | Server-only LLM endpoints: `assistant`, `copilot`, `debrief`, `vision`, `incident-report`. |
| `components/` | React UI. Fan (`assistant/`, `onboarding/`, `alerts/`, `incentives/`), organizer (`organizer/`), shared primitives (`ui/`), map (`StadiumMap.tsx`). |
| `lib/ai/` | Provider-agnostic LLM client, agent loop, tool registry, prompts, sanitization, RAG-lite. |
| `lib/engine/` | Deterministic decision logic. Pure functions plus three store-coupled `*Service.ts` orchestrators. See `lib/engine/README.md`. |
| `lib/simulation/` | Seeded crowd simulation, match sequencer, timeline generation, BroadcastChannel wrapper, God Mode scenarios. |
| `lib/venue/` | Venue graph (`venue.ts`), SVG geometry, POI icons, responder roster, overlay animation variants. |
| `lib/store/` | Zustand stores: `simStore`, `alertStore`, `incentiveStore`, `chatStore`, `roleStore`, `a11yStore`. |
| `lib/validation/` | Zod request schemas (`fanContext`, `simSnapshot`) and the upload dataset validator. |
| `lib/server/` | Route guards: fixed-window rate limiter, size-capped streaming JSON body reader. |
| `lib/voice/` | SpeechRecognition and SpeechSynthesis wrappers, BCP-47 to speech-locale mapping. |
| `lib/onboarding/` | QR payload parsing and demo payload generation. |
| `lib/assistant/` | Browser-side assistant fetch client and the map-action dispatcher. |
| `lib/alerts/`, `lib/incentives/` | React hooks that tick the alert and incentive triage services. |
| `lib/theme/`, `lib/motion/` | Design tokens and shared framer-motion transitions. |
| `data/` | `knowledge.md` (RAG source), `sample-upload.json` (judge upload fixture). |
| `docs/` | This file plus one document per module and foundation. |
| `tests/` | Cross-cutting integration tests. Unit tests are colocated next to their source. |

---

## 3. Data Model

`lib/types.ts` is the source of truth. Summary of each exported type:

| Type | Purpose | Key fields |
|---|---|---|
| `ZoneType` | Zone taxonomy | `'section' \| 'concourse' \| 'gate' \| 'transit' \| 'field'` |
| `Zone` | A node in the venue graph | `id`, `label`, `type`, `tier?`, `stand?`, polar geometry (`angle`, `rInner`, `rOuter`), `attrs: { accessible, enclosed, noise, affiliation? }` |
| `Edge` | A directed walk link between zones | `from`, `to`, `baseWalkSec`, `accessible`, `enclosed`, `noise` |
| `PoiType` | 14 amenity types | `restroom`, `restroom_accessible`, `water`, `food`, `first_aid`, `atm`, `merch`, `info`, `stairs`, `elevator`, `exit`, `security`, `recycling`, `qr_beacon` |
| `Poi` | An amenity pinned near a zone | `id`, `type`, `label`, `nearestZone`, `angle`, `r`, `status: open \| busy \| closed` |
| `MatchPhase` | Full-match clock phase | `pre \| firstHalf \| half \| secondHalf \| fullTime` |
| `SimConfig` | Tick configuration | `tickIntervalMs`, `simSecondsPerTick`, `seed` |
| `SimState` | The simulated world | `matchClockSec`, `density`, `gateStatus`, `incidents[]`, `routedLoad`, `sensorCounts`, `timeline[]`, `sos?` |
| `DensityFrame` | One pre-generated forecast frame | `atSec`, `density`, `gateStatus` |
| `SosState` | Emergency override | `active`, `triggeredBy`, `triggeredAtSec` |
| `FanContext` | Per-fan request context | `language`, `location?`, `accessibility`, `sensory?`, `group?`, `leavingEarly?`, `ticket?` |
| `TicketData` | Scanned ticket fields | `section`, `gate`, `nationality`, `countryCode`, `seat?` |
| `Alert` | A surfaced alert | `id`, `kind: proactive \| incentive \| safety \| ops`, `priority: 1\|2\|3`, `title`, `body`, `zoneId?`, `createdAt`, `action?` |
| `Incident` | A reported problem | `id`, `type: crowd \| medical \| assistance \| security \| evacuation`, `zoneId`, `note`, `status: pending \| dispatched \| resolved`, `createdAt`, `responderId?`, `etaSec?` |
| `Responder` | A dispatchable staff unit | `id`, `label`, `zoneId`, `skills[]`, `available` |
| `Incentive` | A detour coupon | `id`, `fromZone`, `toZone`, `reward`, `qrPayload`, `expiresAt` |
| `AssistantResponse` | The LLM output contract | `message`, `language`, `mapActions[]`, `alertLevel`, `meta?: { tool?, stress?, reportedIncident? }` |
| `Scenario` | A God Mode preset | `id`, `label`, `patch: Partial<SimState>` |
| `UploadDataset` | Judge upload shape | `density?`, `incidents?`, `gateStatus?` |

### Venue graph facts (verified in `tests/venue.test.ts`)

| Item | Count |
|---|---|
| Section zones | 60 (tier 1: 16, tier 2: 20, tier 3: 24) |
| Concourse zones | 60 (one per section, id `con-<sectionId>`) |
| Gate zones | 4 (`gate-a` … `gate-d`) |
| Transit zones | 4 (`transit-train`, `transit-bus`, `transit-taxi`, `transit-parking`) |
| Field zone | 1 (`field-center`) |
| **Total zones** | **129** |
| Distinct POI types | 14 |

Only the radial "stairs" edges between a section and its own concourse node carry
`accessible: false` (`tests/venue.test.ts:193`).

---

## 4. Module Reference

29 modules (M1 to M29), each verified against real files. F1 to F4 are foundations, listed after.

Format per module: **Purpose / Alignment / Inputs and outputs / Key files / Depends on /
Assumptions and limits.**

---

### M1 — QR Location Onboarding
- **Purpose:** Establish the fan's zone by scanning a seat-block QR, scanning a ticket, or picking a block manually.
- **Alignment:** Real-world context starts with knowing where the fan physically is.
- **Inputs / outputs:** Raw QR string or camera frame in; `{ zoneId }` out, written to `simStore.setFanLocation`.
- **Key files:** `lib/onboarding/qr.ts` (`parseQrPayload`, `generateDemoQrPayload`, `parseIncentivePayload`), `components/onboarding/{OnboardingScreen,QrPanel,CameraQrScan,TicketScanCard,BlockPicker,ChangeSeatControl}.tsx`.
- **Depends on:** `jsqr` (decode), `qrcode` (render), `lib/venue/venue.ts` (zone validation), M12 (ticket scan path).
- **Assumptions and limits:** Payloads must match the expected schema; unknown zone ids are rejected. Camera scanning needs `getUserMedia` and fails closed to manual entry.

### M2 — Conversational AI Assistant
- **Purpose:** The fan chat surface and the agent loop behind it.
- **Alignment:** This is the assistant itself.
- **Inputs / outputs:** User text plus `FanContext` and a sim snapshot in; `AssistantResponse` out.
- **Key files:** `components/assistant/{AssistantPanel,ChatInput,MessageList,MessageBubble,QuickActionChips,AssistantEntryPoints}.tsx`, `lib/assistant/client.ts` (`sendAssistantMessage`), `lib/ai/agents.ts` (`runFanAssistant`, `runPlanningLoop`), `app/api/assistant/route.ts`, `lib/store/chatStore.ts`.
- **Depends on:** M3, M5, M7, M13, M15, F4.
- **Assumptions and limits:** Planning loop is capped at 2 tool round trips, then a forced final answer with no tools. Client aborts after 15s (`lib/assistant/client.ts:44`). History is capped at 8 turns, 600 chars per turn.

### M3 — Crowd-Aware Navigation
- **Purpose:** Least-congested walking route and ETA between zones.
- **Alignment:** The core "contextual decision" the LLM is not allowed to make.
- **Inputs / outputs:** origin, destination, `EDGES`, `ZONES`, live density/routedLoad/gateStatus, filters in; `{ path[], etaSec, reason { crowdedZones, avoidedGates }, accessible }` out.
- **Key files:** `lib/engine/routing.ts` (`computeRoute`, `buildGraph`, `congestionFactor`, `shortestDistance`, `sensoryPenalty`), `lib/engine/destinationResolver.ts` (`resolveDestination`), `lib/engine/routingService.ts` (`computeServiceRoute`).
- **Depends on:** F2 (venue graph), M8 (`routedLoadPenalty`), M10, M11.
- **Assumptions and limits:** `computeRoute` takes a pre-resolved destination zone id, not the raw `DestinationQuery` (documented deviation, `lib/engine/routing.ts:6-14`). Closed gates are hard-excluded as pass-through; congested gates are penalized 4x, not excluded.

### M4 — Interactive Stadium Map and Heatmap
- **Purpose:** SVG stadium render with per-zone density coloring.
- **Alignment:** The shared visual twin both personas read.
- **Inputs / outputs:** `ZONES`/`POIS` plus live density and gateStatus in; interactive SVG out, exposing a `StadiumMapHandle` imperative ref.
- **Key files:** `components/StadiumMap.tsx`, `lib/venue/geometry.ts` (`pt`, `sectorPath`, `pctPos`, `densityToBand`), `lib/venue/poiIcons.ts`, `components/StadiumMapErrorBoundary.tsx`.
- **Depends on:** F1, F2, M5, M22, M28.
- **Assumptions and limits:** Superellipse geometry is fixed (`cx=340`, `cy=200`, `SX=260`, `SY=165`). When density is undefined the map renders a neutral shimmer state rather than a heatmap.

### M5 — Dynamic Map Highlighting and Overlay Pipeline
- **Purpose:** Turn `mapActions[]` from the LLM into map overlays.
- **Alignment:** Makes the assistant's answer spatial instead of text-only.
- **Inputs / outputs:** `MapAction[]` (`highlight` / `route` / `pin`) in; imperative calls on `StadiumMapHandle` out.
- **Key files:** `lib/assistant/mapActionDispatcher.ts` (`dispatchMapActions`, `MapAction`, `StadiumMapHandle`), `lib/venue/overlayAnimations.ts` (`highlightVariants`, `routeDrawTransition`, `pinDropVariants`, `EXIT_FADE_MS`).
- **Depends on:** M2, M4.
- **Assumptions and limits:** Unknown zone ids are ignored. A null map handle logs a warning and no-ops rather than throwing.

### M6 — Proactive Smart-Exit Alerts
- **Purpose:** Fire unprompted alerts (exit timing, congestion ahead) without the fan asking.
- **Alignment:** Proactive decision support, not reactive Q&A.
- **Inputs / outputs:** Sim state plus fan context in; `Alert[]` into `alertStore` out.
- **Key files:** `lib/engine/alertTriage.ts` (`evaluateTriggers`, pure), `lib/engine/alertService.ts` (`runAlertTriageService`, store-coupled), `lib/alerts/useProactiveAlerts.ts`, `components/alerts/{AlertStack,AlertCard}.tsx`, `lib/store/alertStore.ts`.
- **Depends on:** M3, M7, M29 (`MATCH_END_ALERT_LEAD_SEC`).
- **Assumptions and limits:** Triage is throttled to once per 10 simulation seconds via a bucketed clock subscription. Active incidents are re-derived from `simStore.incidents` each render rather than pushed through `fireAlert`.

### M7 — Predictive Crowd Forecasting
- **Purpose:** Predict zone density ahead and locate the peak crush.
- **Alignment:** "What will happen" rather than "what is happening".
- **Inputs / outputs:** A `ForecastSource` (pre-generated timeline frames, or a projection function) plus a lookahead in; `ForecastResult` / `PeakCrushResult` out.
- **Key files:** `lib/engine/forecast.ts` (`forecastAt`, `findPeakCrush`, `getForecast`, `getPeakCrush`, `getForecastForAllZones`), `lib/simulation/timeline.ts` (`generateTimeline`, `nearestFrame`).
- **Depends on:** F3.
- **Assumptions and limits:** Timeline frames exist every 60 sim-seconds (`TIMELINE_FRAME_STEP_SEC`). Beyond the timeline, results are flagged `extrapolated`.

### M8 — Anti-Herding Load-Balancer
- **Purpose:** Stop the system routing every fan to the same "best" gate.
- **Alignment:** A recommender that ignores its own influence creates the bottleneck it predicts.
- **Inputs / outputs:** `routedLoad` map and a gate id in; an additive congestion penalty out.
- **Key files:** `lib/engine/loadBalance.ts` (`routedLoadPenalty`, `incrementRoutedLoad`, `decayRoutedLoad`).
- **Depends on:** M3 (`congestionFactor` folds the penalty in).
- **Assumptions and limits:** The load term is capped at 10 so layout advantage is never fully overridden. `routedLoad` decays 0.9x per tick (`ROUTED_LOAD_DECAY`).

### M9 — Smart Bribe Incentives
- **Purpose:** Offer time-limited coupons to pull fans away from an emerging bottleneck.
- **Alignment:** Influences behaviour instead of only reporting it.
- **Inputs / outputs:** Density plus POI status in; `Incentive` objects into `incentiveStore` out.
- **Key files:** `lib/engine/incentiveTriage.ts` (`detectBottlenecks`, pure), `lib/engine/incentiveService.ts` (`runIncentiveTriageService`), `lib/incentives/useProactiveIncentives.ts`, `components/incentives/{IncentiveStack,IncentiveCard}.tsx`, `lib/store/incentiveStore.ts`.
- **Depends on:** M3, M7, M1 (`parseIncentivePayload` for redemption).
- **Assumptions and limits:** Incentives are per-browser only. They ride to the server on each assistant request (`activeIncentives`) because the server cannot read the client store.

### M10 — Hyper-Sensory / Emotional Routing
- **Purpose:** Route around noise, enclosure, and rival-crowd affiliation.
- **Alignment:** Real fans have non-distance constraints (sensory needs, away supporters).
- **Inputs / outputs:** `FanContext.sensory` in; `RouteFilters` out, applied as soft (3x) penalties.
- **Key files:** `lib/engine/sensoryFilters.ts` (`sensoryToRouteFilters`), `lib/engine/routing.ts` (`sensoryPenalty`, `SOFT_FILTER_MULTIPLIER`), `components/settings/SensoryPreferences.tsx`.
- **Depends on:** M3.
- **Assumptions and limits:** Sensory filters are soft only, so a route is always returned. One-off filters from the LLM take per-field precedence over stored preferences (`lib/ai/tools.ts:201-212`).

### M11 — Accessibility-First Routing
- **Purpose:** Exclude stairs-only paths and promote accessible amenity variants.
- **Alignment:** Accessibility is a routing constraint, not a UI afterthought.
- **Inputs / outputs:** `accessibility: true` in; stairs edges hard-excluded and accessible POIs promoted out.
- **Key files:** `lib/engine/facilities.ts` (`prioritizeAccessibleFacilities`), `lib/engine/routing.ts` (`RouteFilters.accessibleOnly`), `lib/engine/accessibilityRouting.test.ts`.
- **Depends on:** M3, F2.
- **Assumptions and limits:** `accessibleOnly` is a hard filter, so it can return `no_accessible_route_found`; the caller re-runs unfiltered to distinguish "no accessible route" from "no route at all".

### M12 — Multilingual Concierge
- **Purpose:** Detect the fan's language from a ticket image or manual choice and reply in it.
- **Alignment:** A World Cup crowd is not monolingual.
- **Inputs / outputs:** Base64 ticket image in; `{ language, confidence, source, ticketData }` out.
- **Key files:** `lib/ai/languageDetection.ts` (`countryCodeToLanguage`, `detectLanguageFromTicket`), `app/api/vision/route.ts`, `components/LanguagePicker.tsx`, `lib/voice/languageTags.ts`.
- **Depends on:** F4 (vision adapter), M1.
- **Assumptions and limits:** Country to language is a fixed table covering 48 nations; multi-language countries (Canada, Belgium, Switzerland, Morocco) return `confidence: 'low'`. Unknown codes fall back to English. Vision requires a provider that supports it; the Groq adapter throws `VisionUnsupportedError`.

### M13 — Voice In and Out
- **Purpose:** Speak to the assistant and have replies read aloud.
- **Alignment:** Hands-free use in a loud, crowded venue.
- **Inputs / outputs:** Microphone audio in, transcript out; reply text in, speech out.
- **Key files:** `lib/voice/speechRecognition.ts` (`createSpeechRecognizer`, `getSpeechRecognitionConstructor`), `lib/voice/speechSynthesis.ts` (`speak`, `stopSpeaking`, `isSpeechSynthesisSupported`), `lib/voice/languageTags.ts` (`toSpeechLocaleTag`), `components/VoiceInputButton.tsx`.
- **Depends on:** M12 (locale), M2, `lib/store/a11yStore.ts` (`ttsEnabled`).
- **Assumptions and limits:** Browser Web Speech API only. `VoiceInputButton` renders nothing when unsupported. Recognition stops on the first final transcript.

### M14 — SOS / Emergency Override
- **Purpose:** A full-screen emergency mode with the safest exit, broadcast to every tab.
- **Alignment:** The highest-stakes real-world decision the system makes.
- **Inputs / outputs:** SOS trigger in; safest exit route plus a takeover UI out.
- **Key files:** `components/SOSOverlay.tsx`, `lib/engine/safeExit.ts` (`computeSafestExit`), `simStore.triggerSos` / `clearSos`, `lib/simulation/channel.ts` (`sos_trigger`, `sos_clear`).
- **Depends on:** M3, M4, F3.
- **Assumptions and limits:** An organizer-triggered SOS cannot be dismissed by the fan (`SOSOverlay.tsx:128-130`). SOS replaces the whole fan view (`app/page.tsx:63`).

### M15 — Stress-Adaptive Safety
- **Purpose:** Detect distress in fan text and escalate: calm the tone, raise the alert level, auto-file an incident.
- **Alignment:** A panicking fan should not have to file a form.
- **Inputs / outputs:** Message text in; `StressDetectionResult` out, plus an optional `Incident`.
- **Key files:** `lib/ai/stressDetection.ts` (`detectStressHeuristic`), `lib/engine/stressEscalation.ts` (`evaluateStressEscalation`), `components/assistant/AssistantPanel.tsx` (calm mode).
- **Depends on:** M2, M16 (the incident lands on the organizer dashboard).
- **Assumptions and limits:** Keyword and punctuation heuristics, English only, deterministic and applied as an override on top of the model's `alertLevel`. "help" alone does not trigger; it needs a co-occurring signal.

### M16 — Organizer Live Ops Dashboard
- **Purpose:** The organizer console: heatmap, alert feed, incidents, cascade summary, sim controls.
- **Alignment:** The operations half of the product.
- **Inputs / outputs:** `simStore` state in; the dashboard UI out.
- **Key files:** `components/organizer/Dashboard.tsx`, `components/organizer/MapSettingsSimPanel.tsx`.
- **Depends on:** M4, M6, M17, M18, M19, M20, M23, M27.
- **Assumptions and limits:** The expensive cascade prediction is memoized on `timeline` only, so it does not re-run on every 1s clock tick (`Dashboard.tsx:65-73`).

### M17 — Dispatch and AI Optimizer
- **Purpose:** Assign the best responder to an incident, predict SLA breach, and write the post-incident report.
- **Alignment:** Closes the loop from detection to human action.
- **Inputs / outputs:** `Incident` plus `RESPONDERS` in; `DispatchAssignment { responderId, etaSec, predictedBreach }` and a text report out.
- **Key files:** `lib/engine/dispatch.ts` (`assignResponder`, `isBreachPredicted`), `components/organizer/DispatchQueue.tsx`, `lib/ai/incidentReport.ts` (`generateIncidentReport`), `app/api/incident-report/route.ts`, `lib/venue/responders.ts`.
- **Depends on:** M3 (ETA), M16, F4.
- **Assumptions and limits:** Skill match is required; the SLA default is 300s. Responder selection is deterministic; only the narrative report uses the LLM, and it degrades to a template on failure.

### M18 — Organizer AI Copilot
- **Purpose:** A risk brief and a 15-minute forecast brief, in natural language.
- **Alignment:** Turns raw telemetry into a decision an operator can act on.
- **Inputs / outputs:** Query plus sim snapshot in; `CopilotBrief { summary, topRisks[], recommendedActions[] }` or `ForecastBrief { peakAtSec, topZones[], narrative, staffingRecommendation }` out.
- **Key files:** `lib/ai/copilot.ts` (`getCopilotBrief`, `getForecastBrief`), `components/organizer/Copilot.tsx`, `app/api/copilot/route.ts`.
- **Depends on:** M7, M24, M25, M26, F4.
- **Assumptions and limits:** Both paths fall back to a deterministic brief built from real incident and forecast data when the LLM fails, and say so. Risk priority is clamped to 1/2/3 rather than trusted from the model.

### M19 — God Mode Scenario Simulator
- **Purpose:** Inject scripted crises on demand for demos and judging.
- **Alignment:** Lets a judge see the system react to a crisis in seconds.
- **Inputs / outputs:** A scenario id or a manual zone override in; a `Partial<SimState>` patch broadcast to all tabs out.
- **Key files:** `components/organizer/GodMode.tsx`, `lib/simulation/scenarios.ts` (`GOD_MODE_SCENARIOS`), `lib/engine/overrideDecay.ts` (`resolveOverriddenDensity`, `OVERRIDE_HOLD_SEC`, `OVERRIDE_DECAY_SEC`), `components/organizer/MapSettingsSimPanel.tsx`.
- **Depends on:** F3, M16.
- **Assumptions and limits:** Three presets ship: `train-bottleneck`, `gate-closure`, `emergency` (an evacuation incident at `sec-104`). Triggering restores baseline first so scenarios do not stack. Manual overrides hold 30s then decay over 20s back to simulated values.

### M20 — Judge Data-Upload Panel
- **Purpose:** Let a judge drop in their own density/gate/incident dataset.
- **Alignment:** Proves the twin is data-driven, not hardcoded to one demo.
- **Inputs / outputs:** Raw JSON text in; `ValidationResult { valid, errors[], data? }` out, applied via `simStore.importDataset` and broadcast.
- **Key files:** `lib/validation/uploadDataset.ts` (`validateUploadDataset`, `validateUploadDatasetObject`, `UPLOAD_MAX_CHARS`), `components/organizer/UploadPanel.tsx`, `data/sample-upload.json`.
- **Depends on:** F2 (zone id validation), F3.
- **Assumptions and limits:** Capped at 200,000 characters. Every zone/gate id must exist in the venue graph; density must be 0..1; unknown top-level keys are rejected. Both the panel and the store import path share one validator.

### M21 — Mobile / Responsive Layout
- **Purpose:** A phone-shaped fan experience, since fans are on phones.
- **Alignment:** The fan persona is mobile by definition.
- **Inputs / outputs:** Viewport width in; a bottom-sheet assistant layout out.
- **Key files:** `app/page.tsx:29-45,76-162` (breakpoint state, floating trigger, bottom sheet), `components/AppShell.tsx`, `tests/mobile.test.tsx`.
- **Depends on:** M2, M4, F1.
- **Assumptions and limits:** Single breakpoint at 768px, stored as a boolean so resize events below the breakpoint do not re-render. A blank shell renders until mount to avoid hydration mismatch.

### M22 — Crowd Flow Vectors
- **Purpose:** Draw directional arrows showing where the crowd is actually moving.
- **Alignment:** Direction of travel is information a static heatmap cannot show.
- **Inputs / outputs:** Current and previous density plus `EDGES` in; `FlowVector[] { edgeId, from, to, magnitude }` out.
- **Key files:** `lib/engine/flowVectors.ts` (`computeFlowVectors`, `FLOW_THRESHOLD = 0.03`), `components/FlowVectorOverlay.tsx`, `simStore.previousDensity`.
- **Depends on:** F2, F3, M4.
- **Assumptions and limits:** Tick-over-tick delta on the destination zone only. Vectors are retained for 2 ticks after dropping below threshold so arrows fade instead of flickering. Returns an empty list when either density snapshot is missing.

### M23 — Cascade Prediction
- **Purpose:** Predict that congestion in one zone will spill into its neighbours.
- **Alignment:** Crowd crushes propagate; predicting the chain is the safety win.
- **Inputs / outputs:** Timeline frames plus `EDGES` in; `Cascade[]` with `CascadeLink` chains out.
- **Key files:** `lib/engine/cascadePrediction.ts` (`predictCascades`, `buildIncomingMap`, `computeFirstCrossings`, `HOTSPOT_THRESHOLD = 0.75`, `CASCADE_LOOKBACK_FRAMES = 5`), `components/CascadeAlertCard.tsx`, `components/CascadeAlertSummary.tsx`.
- **Depends on:** F2, M7, M16.
- **Assumptions and limits:** Reads the pre-generated timeline forward; no new history storage. A zone is a hotspot above 0.75 density.

### M24 — Automated Staff Pre-Positioning
- **Purpose:** Recommend moving a responder toward a predicted hotspot before it forms.
- **Alignment:** Acts on the forecast instead of only displaying it.
- **Inputs / outputs:** A `ForecastHotspot` plus responders and `EDGES` in; `PrepositionRecommendation[] { responderId, fromZone, toZone, recommendedDepartSec, willArriveInTime }` out.
- **Key files:** `lib/engine/staffPrepositioning.ts` (`recommendPrepositioning`, `DEFAULT_PREPOSITION_COUNT`), consumed in `app/api/copilot/route.ts:50-69`.
- **Depends on:** M3 (travel time), M7, M17 (responder availability), M18.
- **Assumptions and limits:** Responders already committed to an unresolved incident are excluded. A recommendation is still returned when the responder cannot arrive in time, flagged `willArriveInTime: false`.

### M25 — Bottleneck Root-Cause Explanation
- **Purpose:** Explain why a zone is congested by walking the causal graph backward.
- **Alignment:** An operator needs the cause, not just the symptom.
- **Inputs / outputs:** A zone id, frame history, gate status, incidents, `EDGES` in; `RootCauseChain { chain: CauseLink[] }` out.
- **Key files:** `lib/engine/rootCause.ts` (`traceRootCause`), consumed in `app/api/copilot/route.ts:101-115` and `lib/engine/debriefData.ts`.
- **Depends on:** M23 (shares the adjacency direction), M18, M27.
- **Assumptions and limits:** Uses the same frame history M23 reads forward; no additional storage. Chains terminate at a gate closure, an incident, or an upstream hotspot.

### M26 — Forecast Confidence Intervals
- **Purpose:** Put a band around a point prediction instead of a false-precision number.
- **Alignment:** Honest uncertainty is what makes a forecast usable operationally.
- **Inputs / outputs:** A `PointPrediction` plus timeline and zone id in; `ConfidenceBand { densityLow, densityHigh, crossingSecEarliest, crossingSecLatest, method }` out.
- **Key files:** `lib/engine/forecastConfidence.ts` (`computeConfidenceBand`), consumed in `app/api/copilot/route.ts:71-82`.
- **Depends on:** M7, M18.
- **Assumptions and limits:** Wraps forecast output and does not alter the prediction. `method` is `'sampled'` when enough frames exist, otherwise `'heuristic'`.

### M27 — Post-Event Debrief Report
- **Purpose:** A one-shot retrospective: bottlenecks, root causes, response times, near misses.
- **Alignment:** Closes the operational loop after the match.
- **Inputs / outputs:** Final `SimState` in; a markdown-ish report string out.
- **Key files:** `lib/engine/debriefData.ts` (`aggregateDebriefData`, `DebriefInput`, `DebriefBottleneck`, `DebriefIncidentStat`), `components/organizer/DebriefReport.tsx`, `app/api/debrief/route.ts`.
- **Depends on:** M7, M17, M25, F4.
- **Assumptions and limits:** Gated to full time: either `sequencerPhase` is `post`/`idle` or `matchPhase(matchClockSec) === 'fullTime'`, otherwise the route returns 400. Falls back to `buildFallbackReport`, built entirely from aggregated data, when the LLM fails.

### M28 — Agent-Based Crowd Flow Visualization
- **Purpose:** Cosmetic moving dots that make density legible as people.
- **Alignment:** Presentation layer for the twin; explicitly not a data source.
- **Inputs / outputs:** Zones plus density in; `Agent[]` positions out, stepped per frame.
- **Key files:** `lib/engine/agentMotion.ts` (`spawnAgents`, `stepAgents`, `MAX_AGENTS = 300`), `components/CrowdAgentLayer.tsx`, `simStore.showCrowdAgents`.
- **Depends on:** F3 (`mulberry32` seeded PRNG), M4.
- **Assumptions and limits:** Off by default because of the render cost. Purely cosmetic: agent positions never feed density, routing, or alerts.

### M29 — Automatic Match Sequencer
- **Purpose:** Drive the demo through pre-match, live, and egress without anyone clicking.
- **Alignment:** A judge sees a full match lifecycle in minutes.
- **Inputs / outputs:** A seed plus a session start timestamp in; `SequencerState { phase, phaseElapsedSec }` and per-zone density curves out.
- **Key files:** `lib/simulation/matchSequencer.ts` (`computeSequencerState`, `initSequencer`, `ingressDensityForZone`, `liveDensityForZone`, `egressDensityForZone`, `getScheduledLiveIncidents`), `simStore.startAutoSequencer`, channel message `SEQUENCER_INIT`.
- **Depends on:** F3, M6, M16.
- **Assumptions and limits:** Compressed timings: 120s pre-match, 300s live, 120s egress (`LIVE_PHASE_END_SEC = 420`, `POST_PHASE_END_SEC = 540`). The seed and start time are broadcast once; every tab re-derives the identical state locally rather than receiving per-tick updates.

---

### Foundations

**F1 — Design System and App Shell.** `lib/theme/tokens.ts` (accent `#2563EB`), `lib/motion/transitions.ts`, `components/ui/*`, `components/AppShell.tsx`, `components/RoleToggle.tsx`, `components/A11yControls.tsx`. Doc: `docs/f1-design-system.md`.

**F2 — Venue Graph and Data Model.** `lib/venue/venue.ts` (`ZONES`, `EDGES`, `POIS`, `GATES`, `TRANSIT_NODES`, `TIERS`, `FACILITY_SPECS`, `getZone`, `getEdgesFrom`, `getPoisNear`), `lib/types.ts`. Doc: `docs/f2-venue-graph.md`.

**F3 — Simulation Engine.** `lib/simulation/engine.ts`, `timeline.ts`, `channel.ts`, `scenarios.ts`, `lib/store/simStore.ts`. Doc: `docs/simulation.md`. See section 7.

**F4 — Provider-Agnostic AI Layer.** `lib/ai/*`. Doc: `docs/ai-layer.md`. See section 5.

---

## 5. AI Layer

### 5.0 Model in use

This build runs **Google `gemini-3.1-flash-lite`**, configured entirely through `.env`:

```bash
LLM_PROVIDER=gemini
LLM_MODEL=gemini-3.1-flash-lite
LLM_TIMEOUT_MS=8000
```

It backs all five LLM-backed routes: the fan agent loop (`/api/assistant`, M2), the organizer
copilot brief and forecast narration (`/api/copilot`, M18), the post-event debrief
(`/api/debrief`, M27), the incident report (`/api/incident-report`, M17), and the ticket-scan
vision path (`/api/vision`, M12).

Why this provider and tier, both verifiable:

| Reason | Evidence |
|---|---|
| Vision requires Gemini | `GroqClient.visionChat` throws `VisionUnsupportedError` (`lib/ai/client.ts:613`). `GeminiClient.supportsVision = true`. M12's ticket scan calls `visionChat`, so Groq cannot serve it. |
| Latency budget | The fan planning loop allows up to 2 tool round trips plus a forced final answer, each capped at `LLM_TIMEOUT_MS` (default 8000ms, `lib/ai/env.ts:12`), all inside a 15s client abort (`lib/assistant/client.ts:44`). A Flash-Lite tier model keeps a multi-call turn inside that budget. |
| Native structured output | The Gemini adapter requests the `{ message, language, mapActions, alertLevel }` contract at the API level via `responseSchema` (`GEMINI_RESPONSE_SCHEMA`, built once at module load), rather than only asking for it in the prompt. Groq falls back to `response_format: { type: 'json_object' }`. |

The model id is **not** hardcoded anywhere. It is read once from `process.env` through the
zod-validated accessor in `lib/ai/env.ts` and passed verbatim to the selected adapter
(`lib/ai/client.ts:256,418,549`). Changing `LLM_MODEL` or setting `LLM_PROVIDER=groq` swaps the
model or the entire provider with no code change. The guard test in `tests/ai/client.test.ts`
(describe `provider-agnostic invariant`) recursively scans `lib/`, `app/`, and `components/` and
fails the suite if any provider or model id literal is reintroduced into shipped source.

### 5.1 Provider adapter contract

`lib/ai/client.ts` defines:

```ts
interface AiClient {
  supportsVision: boolean;
  chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult>;
  visionChat(messages: ChatMessage[], imageBase64: string, mimeType: string): Promise<ChatResult>;
}
```

`createClient()` selects `GeminiClient` or `GroqClient` from `AI_ENV.LLM_PROVIDER`. Two adapters
ship today. Config comes from `lib/ai/env.ts`, which zod-validates `LLM_PROVIDER` (enum
`gemini | groq`), `LLM_MODEL`, `LLM_API_KEY`, and `LLM_TIMEOUT_MS` (default 8000) and caches the
result behind a proxy that rethrows the parse error on access.

Transport behaviour: one retry on 5xx or 429 (with a 250ms wait on 429), zero retries on 4xx,
per-request `AbortController` timeout, and provider error text extracted but wrapped in
`AiClientError` so raw provider messages do not leak to the client.

Gemini specifics: `thoughtSignature` is captured off each `functionCall` part and echoed back when
that turn is replayed as history, which the Gemini function-calling protocol requires.

### 5.2 Tool registry

`lib/ai/tools.ts` exports `TOOL_REGISTRY`, `getToolSchemas()`, and `executeTool()`. Eight tools:

| Tool | Inputs | Output | Delegates to |
|---|---|---|---|
| `computeRoute` | `originZoneId` (or legacy `fromZoneId`), `destination { kind: zone \| poiType \| nearestExit }`, `filters` | `{ path[], etaSec, reason { crowdedZones, avoidedGates }, accessible }` | `resolveDestination` + `computeRoute` (M3) |
| `findAmenity` | `fromZoneId`, `type`, `nearestOpen` | Top 3 POIs by BFS hop count | `POIS`, `prioritizeAccessibleFacilities` (M11) |
| `getForecast` | `zoneId`, `timeSec` | `{ predictedDensity, extrapolated, peakCrush }` | `getForecast` / `getPeakCrush` (M7) |
| `getPeakCrush` | `zoneId` | `{ peakMatchClockSec, peakDensity, minutesFromNow }` | `getPeakCrush` (M7) |
| `detectStress` | `text` | `StressDetectionResult` | `detectStressHeuristic` (M15) |
| `getIncentive` | `fromZoneId` | An active incentive or `{ found: false }` | `ctx.activeIncentives` (M9) |
| `getPolicy` | `query` | Top 2 knowledge chunks | `retrieve` (RAG, below) |
| `reportIncident` | `type`, `note` | `{ success, incident }` | Returned for the client to apply (M15/M16) |

Origin and destination zone ids are validated against `ZONES` before routing, so a hallucinated id
returns `{ error: 'invalid_zone_id' }` rather than reaching the engine. Unknown tool names throw
`UnknownToolError`.

### 5.3 Structured output contract, as enforced

`lib/ai/agents.ts:20-33`:

```ts
const assistantResponseSchema = z.object({
  message: z.string(),
  language: z.string(),
  mapActions: z.array(z.object({
    op: z.enum(['highlight', 'route', 'pin']),
    zoneId: z.string().optional(),
    path: z.array(z.string()).optional(),
  })),
  alertLevel: z.enum(['none', 'info', 'warn', 'critical']),
  meta: z.object({ tool: z.string().optional(), stress: z.boolean().optional() }).optional(),
});
```

Enforcement path in `parseResponse` (`lib/ai/agents.ts:129`):
1. Extract the JSON object from the raw text (tolerates prose or markdown fences).
2. `JSON.parse` then `assistantResponseSchema.parse`.
3. On failure, `buildLenientFallback` salvages a usable reply (checks `message`, `error`,
   `response`, `text`, `summary` keys; validates `mapActions` entry by entry; clamps `alertLevel`).
4. The deterministic stress heuristic overrides `alertLevel` afterwards, so the model cannot
   downgrade an emergency.
5. `injectMissingPaths` back-fills a `route` action from tool output if the model computed a route
   but forgot to emit the action.

The Gemini adapter additionally requests this shape natively via a `responseSchema`
(`GEMINI_RESPONSE_SCHEMA`, built once at module load); Groq uses `response_format: json_object`.

### 5.4 Prompt-injection defense

`lib/ai/sanitize.ts` is the single sanitization path. Two layers:
1. Strip every XML block delimiter used in any prompt template (`user_message`, `user_query`,
   `incident`, `assignment`, `stadium_snapshot`, `forecast_calculations`), open and close variants,
   case-insensitive, replaced with `[filtered]`.
2. Neutralize override idioms (`ignore previous instructions`, `disregard the system prompt`,
   `reveal your system prompt`, `you are now a ...`), scoped to multi-word patterns so ordinary
   phrasing like "ignore the previous gate" is untouched.

Every user-supplied string passes through it before entering a prompt: chat text and history
(`agents.ts:321,348`), fan-context fields interpolated into the system message (`agents.ts:328`),
organizer queries and incident notes (`copilot.ts:40,51`), and incident id/zone/responder
(`incidentReport.ts:18-23`). System prompts additionally instruct the model that tagged content is
untrusted, and `VISION_TICKET_PROMPT` states that text visible in the image is untrusted data.

For images, containment is structural: `detectLanguageFromTicket` copies only five known string
fields out of the model's JSON, and `countryCode` is then mapped through a fixed table, so
adversarial image text cannot widen the output surface.

### 5.5 RAG-lite

`lib/ai/rag.ts` loads `data/knowledge.md` from disk once, splits on `##` headings into
`{ section, content }` chunks, and scores by unique query-word overlap, returning the top 2 with
ties broken by original order. There are no embeddings and no vector store.

---

## 6. Engine Reference

All paths under `lib/engine/`. Pure modules take state as arguments and import no store, React, or
network module. The three `*Service.ts` files are the store-coupled orchestration layer; see
`lib/engine/README.md`.

| Function | File | Signature summary | Algorithm |
|---|---|---|---|
| `computeRoute` | `routing.ts:434` | `(origin, destZoneId, edges, zones, density, routedLoad, gateStatus, filters?, sensory?, prebuilt?) => RouteResult \| RouteError` | Dijkstra over a weighted graph using a binary min-heap, O((V+E) log V). Optionally re-runs a naive unweighted graph to explain which zones/gates were avoided. |
| `buildGraph` | `routing.ts:179` | `(edges, zones, filters, gateStatus, density, routedLoad, sensory?) => Graph` | Weight = `baseWalkSec * congestionFactor`, then sensory penalty, then 4x for congested gates and 3x for each matching soft filter. Closed gates and (if `accessibleOnly`) stairs edges are excluded. |
| `congestionFactor` | `routing.ts:148` | `(density, load, routedLoad?, gateId?) => number` | `1 + 2.5*d + routedLoadPenalty`, monotone in both, load capped. |
| `shortestDistance` | `routing.ts:379` | `(graph, from, to) => number` | Dijkstra cost only, no path reconstruction. |
| `sensoryPenalty` | `routing.ts:53` | `(edge, toZone, options) => number` | Adds 50% of `baseWalkSec` per matching sensory condition. |
| `resolveDestination` | `destinationResolver.ts:50` | `(query, origin, edges, zones, pois, poiStatus, gateStatus, routedLoad) => string \| ResolveError` | Ranks POIs or gates by distance plus routed load. Density deliberately excluded: congestion affects the route to a destination, not which destination is chosen. |
| `routedLoadPenalty` | `loadBalance.ts:10` | `(routedLoad, gateId) => number` | `0.15 * min(load, 10)`. |
| `decayRoutedLoad` | `loadBalance.ts:34` | `(routedLoad) => Record<string, number>` | Multiplicative 0.9 decay per tick. |
| `forecastAt` | `forecast.ts:52` | `(timeline, matchClockSec, lookaheadSec) => ForecastResult` | Nearest-frame lookup, or projection when no timeline exists. |
| `findPeakCrush` | `forecast.ts:153` | `(timeline, matchClockSec, windowSec) => PeakCrushResult` | Scans frames in the window for the maximum density and its top zones. |
| `assignResponder` | `dispatch.ts:15` | `(incident, responders, edges, zones, ...) => DispatchAssignment` | Filters by skill and availability, ranks by travel time, returns the best plus `predictedBreach`. |
| `isBreachPredicted` | `dispatch.ts:71` | `(etaSec, slaSec = 300) => boolean` | ETA over SLA. |
| `evaluateTriggers` | `alertTriage.ts:56` | `(input: TriageInput) => Alert[]` | Threshold rules over density, gate status, and match clock. |
| `detectBottlenecks` | `incentiveTriage.ts:18` | `(input) => string[]` | Returns zone ids above the bottleneck threshold. |
| `predictCascades` | `cascadePrediction.ts:75` | `(frames, edges) => Cascade[]` | Computes first threshold crossings per zone, then links a hotspot to upstream neighbours that crossed earlier within the lookback window. |
| `traceRootCause` | `rootCause.ts:44` | `(zoneId, history, gateStatus, incidents, edges) => RootCauseChain` | Walks the incoming-edge map backward from the congested zone to a gate closure, incident, or earlier hotspot. |
| `computeConfidenceBand` | `forecastConfidence.ts:35` | `(point, timeline, zoneId) => ConfidenceBand` | Samples timeline variance where available, else a heuristic spread. |
| `recommendPrepositioning` | `staffPrepositioning.ts:38` | `(hotspot, responders, edges) => PrepositionRecommendation[]` | Picks the nearest available responder and back-computes a depart-by time from predicted crossing minus travel time. |
| `computeSafestExit` | `safeExit.ts:23` | `(input: SafeExitInput) => SafeExitResult` | Lowest-risk open exit for the SOS overlay. |
| `computeFlowVectors` | `flowVectors.ts:18` | `(currentDensity, previousDensity, edges) => FlowVector[]` | Per-edge destination-density delta above `FLOW_THRESHOLD`; returns `[]` if either snapshot is missing. |
| `resolveOverriddenDensity` | `overrideDecay.ts:14` | `(override, simulated, nowMs) => number` | Holds the manual value 30s, then ramps back to simulated over 20s. |
| `aggregateDebriefData` | `debriefData.ts:39` | `(state, edges) => DebriefInput` | Top bottlenecks with root-cause chains plus incident response stats. |
| `prioritizeAccessibleFacilities` | `facilities.ts:52` | `(pois, fromZoneId, needsAccessible) => Poi[]` | Promotes an accessible variant when it is comparably close. |
| `sensoryToRouteFilters` | `sensoryFilters.ts:29` | `(sensory) => RouteFilters` | Maps stored preferences onto soft route filters. |
| `evaluateStressEscalation` | `stressEscalation.ts:17` | `(input) => Incident \| null` | Creates a deduplicated incident when distress is detected. |
| `spawnAgents` / `stepAgents` | `agentMotion.ts:46,89` | `(zones, density, seed, ...)` / `(agents, density, deltaMs)` | Seeded spawn and per-frame motion, capped at `MAX_AGENTS = 300`. |

Store-coupled orchestrators: `runAlertTriageService()` (`alertService.ts:21`),
`runIncentiveTriageService()` (`incentiveService.ts:21`), `computeServiceRoute()`
(`routingService.ts:42`).

---

## 7. Simulation Engine

`lib/simulation/engine.ts` plus `lib/store/simStore.ts`.

### Tick model

`simStore` runs `setInterval(tick, 1000)` (`simStore.ts:445`), one tick per real second. Each tick
snapshots `previousDensity`, recomputes density, blends sensor influence, decays routed load, and
recomputes gate status.

Constants (`engine.ts:4-21`): `MATCH_START_SEC = -1800`, `FIRST_HALF_END_SEC = 2700`,
`HALFTIME_END_SEC = 3600`, `SECOND_HALF_END_SEC = 6300`, `FULL_TIME_END_SEC = 8100`,
`TIMELINE_FRAME_STEP_SEC = 60`, `SENSOR_SATURATION = 8`, `SENSOR_WEIGHT = 0.3`,
`ROUTED_LOAD_DECAY = 0.9`, `GATE_CONGESTION_THRESHOLD = 0.7`, `SESSION_TTL_MS = 10000`.

Density is deterministic given a seed: `mulberry32(seed)` plus `hashZoneId(zoneId)` feed
`computeBaseDensity(zone, matchClockSec, seed?)`, so every tab computes identical values without
exchanging density data.

### Timeline generation

`generateTimeline(zones, seed)` (`timeline.ts:10`) pre-computes one `DensityFrame` per 60
sim-seconds across the match. `nearestFrame(timeline, targetSec)` is the lookup used by M7, M23,
M25, M26, and M27. Because the timeline is pre-generated, forecasting reads it rather than
simulating forward.

### Fan as sensor

`heartbeat(zoneId)` posts a `HEARTBEAT` over the channel. `pruneAndCountSessions` drops entries
older than `SESSION_TTL_MS` and counts live sessions per zone. `blendSensorInfluence(base, count)`
mixes that count into density at `SENSOR_WEIGHT = 0.3`, saturating at `SENSOR_SATURATION = 8`.
More open fan tabs in a zone therefore raise its measured density.

### God Mode hooks

`applyScenario(patch, isGodMode?)` merges a `Partial<SimState>` and broadcasts `SCENARIO`.
`mergeStatePatch` (`engine.ts:185`) applies it. Manual per-zone density edits are held in
`manualDensityOverrides` and resolved through M19's decay curve. `reset(zones, config)` broadcasts
`RESET`.

### Judge import

`importDataset(dataset)` validates through `validateUploadDatasetObject` and returns
`{ ok: true } | { ok: false, error }`, then broadcasts `IMPORT` so every tab converges.

### Sequencer

`startAutoSequencer(zones)` initialises M29 and broadcasts `SEQUENCER_INIT { seed,
sessionStartedAtMs }` once. Every tab derives phase and density locally from that seed.

---

## 8. Security Model

| Control | Implementation |
|---|---|
| Key handling | `LLM_API_KEY` is read only in `lib/ai/env.ts`, used only inside route handlers, and sent as a request header (`client.ts:370,484`), never a query string. It is absent from the client bundle. `.env` is gitignored; `.env.example` holds placeholders only. |
| Request validation | Every route parses its body with a zod `.strict()` schema: `lib/validation/fanContext.ts`, `lib/validation/simSnapshot.ts`, and per-route schemas. Unknown keys are rejected. Every string is length-capped (message 2000, note 2000, language 35, zone ids 120). Arrays are capped (incidents 200, timeline 1000, history 20, incentives 20). |
| Body size | `lib/server/readJsonBody.ts` enforces a byte cap while streaming and cancels the read once exceeded, so an oversized body is never fully buffered or parsed. Caps: assistant 1MB, copilot/debrief 2MB, vision 8MB, incident-report 64KB. |
| Rate limiting | `lib/server/rateLimit.ts` fixed-window limiter, 30 requests/60s per client plus a 300/60s global per-route backstop. Client identity comes only from `x-vercel-forwarded-for` (a proxy-set header); an untrusted `x-forwarded-for` is deliberately ignored so header forging cannot mint fresh buckets. |
| Image validation | `app/api/vision/route.ts` restricts `mimeType` to `image/jpeg | image/png`, rejects payloads over 5MB by cheap length arithmetic before running the base64 regex, and validates the base64 alphabet. |
| Injection defense | See section 5.4. Plus zone-id allowlisting in `lib/ai/tools.ts` and whitelist extraction in `lib/ai/languageDetection.ts:181-192`. |
| Error handling | Routes return generic messages (`'Invalid request payload'`, `'Too many requests'`). Zod internals and provider error text never reach the client; the real cause is logged server-side only. |
| Upload safety | `lib/validation/uploadDataset.ts` caps at 200,000 chars, rejects unknown top-level keys, and validates every zone/gate id against the venue graph. |

No authentication or authorization exists. The role toggle is a client-side UI switch, not a
security boundary.

---

## 9. Testing Strategy

Runner: Vitest 4 with jsdom (`vitest.config.ts`, setup `tests/setup.ts`). Unit tests are colocated
with their source (`lib/engine/routing.test.ts`); cross-cutting tests live in `tests/`.

**Commands**

```bash
npm test          # vitest run
npm run build     # next build (also typechecks and lints)
npm run lint      # eslint
```

**Current state:** 68 test files, 436 tests, all passing.

| Area | Where |
|---|---|
| Engine (pure) | `lib/engine/*.test.ts`: routing, destinationResolver, forecast, forecastConfidence, dispatch, loadBalance, cascadePrediction, rootCause, staffPrepositioning, debriefData, alertTriage, incentiveTriage, flowVectors, agentMotion, overrideDecay, safeExit, sensoryFilters, sensoryRouting, accessibilityRouting, stressEscalation |
| AI layer | `tests/ai/{client,agents,tools,rag,routes}.test.ts`, `lib/ai/{copilot,incidentReport,languageDetection,stressDetection}.test.ts` |
| Simulation | `tests/simulation/{engine,store,timeline,channel}.test.ts`, `lib/simulation/{matchSequencer,scenarios}.test.ts` |
| Venue | `tests/venue.test.ts`, `lib/venue/geometry.test.ts` |
| UI | `tests/StadiumMap.test.tsx`, `tests/assistant/AssistantPanel.test.tsx`, `tests/onboarding/*`, `tests/alerts/*`, `tests/incentives/*`, `tests/settings/*`, `tests/appShell.test.tsx`, `tests/mobile.test.tsx`, plus colocated component tests |
| Server guards | `tests/server/requestGuards.test.ts` |

**LLM mocking.** No test performs a network call. `tests/ai/client.test.ts` stubs global `fetch`
and drives the adapters directly. Higher-level tests mock `createClient` (`lib/ai/copilot.test.ts`,
`lib/ai/incidentReport.test.ts`) or the browser fetch client
(`tests/assistant/AssistantPanel.test.tsx` mocks `lib/assistant/client`).

**Invariant guard.** `tests/ai/client.test.ts`, describe `provider-agnostic invariant`, recursively
scans `lib/`, `app/`, and `components/` (excluding test files) and fails if any provider or model id
literal appears in shipped source.

---

## 10. Accessibility Notes

Implemented, verified in code:

| Area | Detail |
|---|---|
| Keyboard | Every interactive map element (60 sections, 4 gates, 4 transit nodes, POI markers) has `role="button"`, `tabIndex={0}`, and an `onKeyDown` handler for Enter and Space (`components/StadiumMap.tsx:128-149,596-660,906-920`). Covered by `tests/StadiumMap.test.tsx:98`. |
| Focus visibility | `.map-interactive:focus-visible` gives focused map elements an outline and stroke change. Buttons elsewhere use `focus-visible:ring-2`. |
| ARIA | `aria-label` on icon-only controls, `role="log"` with `aria-live="polite"` on the message list, `role="region"` on the copilot and God Mode panels, `aria-label` describing each section's density state. |
| Reduced motion | `useReducedMotion` gates framer-motion animations (`VoiceInputButton`, `AppShell`, `app/page.tsx` bottom sheet), and `@media (prefers-reduced-motion: reduce)` disables the map shimmer and pulse rings. |
| Text to speech | `lib/voice/speechSynthesis.ts`, toggled by `a11yStore.ttsEnabled`, per-message replay in `MessageBubble`. |
| Font scaling | `a11yStore.fontScale` (1, 1.15, 1.3) applied via a `--font-scale` custom property in `A11yControls`. |
| Accessible routing | `RouteFilters.accessibleOnly` hard-excludes stairs edges; `prioritizeAccessibleFacilities` promotes accessible amenities (M11). |
| Sensory preferences | `components/settings/SensoryPreferences.tsx` (M10). |

Known gaps: contrast has been checked by calculation for the header text on the accent background,
not by an automated axe or Lighthouse sweep of every view. `components/ui/toast.tsx` ships an
unlabeled `ToastClose` primitive, but it is not rendered anywhere.

---

## 11. Known Limitations and Assumptions

1. **Prior docs overstated the venue size.** The previous README described a "92-zone venue graph".
   The real graph is 129 zones (60 sections, 60 concourse, 4 gates, 4 transit, 1 field), verified
   against `lib/venue/venue.ts` and `tests/venue.test.ts`.
2. **Two time models coexist.** `lib/simulation/engine.ts` defines a full match clock
   (`MATCH_START_SEC = -1800` through `FULL_TIME_END_SEC = 8100`), while
   `lib/simulation/matchSequencer.ts` (M29) drives the demo on a compressed 120/300/120 second
   timeline. `app/api/debrief/route.ts:76-78` accepts either as a full-time signal. They are not
   unified.
3. **`lib/engine/` is not uniformly pure.** `alertService.ts`, `incentiveService.ts`, and
   `routingService.ts` import Zustand stores. The split is by naming convention and documented in
   `lib/engine/README.md`; it is not enforced by tooling.
4. **A tool touches a store.** `computeRoute` in `lib/ai/tools.ts:240-243` calls
   `useSimStore.getState().incrementRoutedLoad`. Stores are per-process, so on the server this is a
   no-op and the client's own `routingService` accounting is the real source of truth. The call is
   effectively test-environment-only.
5. **Prompt-injection defense is best-effort.** Tag stripping plus idiom patterns reduce the attack
   surface; they are not a guarantee. The structured output contract, tool gating, and zone-id
   allowlisting are what actually bound the blast radius.
6. **RAG is keyword overlap, not semantic.** `lib/ai/rag.ts` scores by unique word presence. A
   query phrased differently from `data/knowledge.md` may retrieve nothing.
7. **Rate limiting is per-instance.** `lib/server/rateLimit.ts` holds buckets in process memory. A
   multi-instance or serverless deployment would need a shared store.
8. **BroadcastChannel is same-browser, same-origin.** "Multi-tab sync" is not multi-user sync. Two
   people on two devices do not share state.
9. **No authentication and no database.** The role toggle is a UI control. All state is client-side
   and lost on reload, except the fan location in `localStorage`.
10. **Vision depends on the provider.** `GroqClient.visionChat` throws `VisionUnsupportedError`.
    Nothing validates that the configured `LLM_MODEL` actually supports vision or tool calling.
11. **Stress detection is English-only** keyword and punctuation matching (`lib/ai/stressDetection.ts`),
    which is a gap against the multilingual goal of M12.
12. **Crowd agents are cosmetic and off by default** (`MAX_AGENTS = 300`, `simStore.showCrowdAgents`).
13. **Simulated data throughout.** No real sensor, ticketing, or transit feed. Density comes from a
    seeded function of zone id and match clock.
14. **`components/ui/toast.tsx` is unused** scaffolding not wired to any surface.

---

## 12. Changelog / Audit History

A two-step audit ran against this codebase: a read-only evaluation across six categories
(problem-statement alignment, code quality, security, efficiency, testing, accessibility),
followed by a fix pass and a full regression re-audit. Outcome at the end of that pass: production
build clean with no warnings, 436 of 436 tests passing, and no provider or model id literals in
shipped source (enforced by the guard test in `tests/ai/client.test.ts`).

Two documentation files were removed during that work because they were superseded or stale:
`docs/STADIUMIQ-MASTER-DOCUMENTATION.txt` (a duplicate of this file in plain text) and
`docs/full-audit-report.md` (a point-in-time audit report that referenced deleted modules).

Per-module documentation remains authoritative for module-level detail and lives alongside this
file in `docs/`.
