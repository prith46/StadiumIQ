# StadiumIQ — Full Codebase Audit Report

**Type:** Read-only triage / reporting pass (NO fixes applied)
**Date:** 2026-07-11
**Scope:** F1–F4 foundations + M1–M20 modules
**Auditor spec basis:** `docs/STADIUMIQ-MASTER-DOCUMENTATION.md` + per-module docs (`docs/M*.md`, `docs/m*.md`)

> **⚠ Spec-file discrepancy (meta-finding):** The requested authoritative spec `stadiumiq-plan.md` **does not exist** anywhere in the repo (searched `E:\StadiumIQ` and `E:\StadiumIQ\stadiumiq`, excluding node_modules/.next/.git). This audit therefore checks against `STADIUMIQ-MASTER-DOCUMENTATION.md` — which itself only documents **F1–F4 and M1–M9**; M10–M20 have only individual per-module `docs/*.md` files and are not consolidated. Any plan-vs-code check below is against the master doc + module docs, not the missing plan file. **Confirm which file was intended as the plan.**

Severity legend: **CRITICAL** (functional/security failure) · **MODERATE** (contract/consistency/maintainability) · **MINOR** (cosmetic/low-risk).

---

## 1. Cross-Module Contract Consistency

`computeRoute` signature (`lib/engine/routing.ts:405`): `(originZoneId, destinationZoneId, edges, zones, density, routedLoad, gateStatus, filters?, sensory?)`. All 7 real call sites were traced.

| # | Sev | File:Line | Finding |
|---|-----|-----------|---------|
| 1.1 | MODERATE | `lib/engine/routingService.ts:63-97` | `computeServiceRoute` builds `effectiveFilters` from the `filters` arg + `fanContext.accessibility` **only** — it never merges `fanContext.sensory` via `sensoryToRouteFilters`. By contrast `alertService.ts:74-80`, `incentiveService.ts:23`, and `tools.ts:195-202` all DO merge persistent sensory. Consequence: the **M9 incentive accept-reroute** (`IncentiveCard.tsx:100`) and the **M6 current-route** (`useProactiveAlerts.ts:51`) silently ignore the fan's persistent sensory preferences — directly contradicting the doc claim in `SensoryPreferences.tsx:16-19` ("every subsequent computeRoute call across chat, alerts, and incentives picks up the preference"). |
| 1.2 | MODERATE | `app/api/vision/route.ts:63` | Vision route emits `mapActions: [{ type: 'highlightZone', zoneId, pulse }]`, but the `AssistantResponse.mapActions` contract (`lib/types.ts:135`) is `{ op: 'highlight'|'route'|'pin', zoneId?, path? }`. Shape mismatch — these actions would not dispatch through the standard `mapActionDispatcher` pipeline (`op` is undefined). |
| 1.3 | MINOR | `lib/engine/routing.ts:414` | The 9th param `sensory?: SensoryFilterOptions` is **dead**: no caller in the codebase passes it (every caller folds sensory into `filters` instead). Either wire it or remove it. |
| 1.4 | MINOR | `lib/engine/routing.ts:429-437` | `no_accessible_route_found` returns `errObj as any` with `Object.defineProperties(...enumerable:false)` — a type assertion that hides the real shape from the type system and relies on non-enumerable props (`noRouteFound`, `path:null`) that consumers access via `(result as any)`. |
| 1.5 | MINOR | `app/api/assistant/route.ts:55`, `lib/ai/tools.ts:142,229` | `as any` casts on `ctx` and `require('../store/simStore')` (CommonJS require inside ESM) that could mask shape drift. |

`Alert`/`Incident`/`Zone`/`FanContext`/`SimState` construction sites otherwise match `lib/types.ts`. All `useSimStore` consumers destructure current field names (SOS, `routedLoad`, `sensorCounts`, `sos` all present). `routedLoad` + `gateStatus` are passed correctly by every `computeRoute` caller.

---

## 2. Dead / Orphaned Code

| # | Sev | File:Line | Finding |
|---|-----|-----------|---------|
| 2.1 | MODERATE | `lib/ai/agents.ts:167` | `runOrganizerCopilot` is **orphaned** — never called in production. `/api/copilot/route.ts` uses `getCopilotBrief`/`getForecastBrief` from `lib/ai/copilot.ts` instead. Two overlapping organizer-AI implementations exist; one is dead. |
| 2.2 | MODERATE | `lib/ai/tools.ts:424-448` | `getIncentive` is a **registered live tool** that returns a hardcoded `{ __stub: true }` with a `TODO(M9)` (line 437). The LLM can call it and receive empty stub data. M9 is documented as complete. |
| 2.3 | MODERATE | `lib/ai/agents.ts:38-42`, `copilot.ts:38-42`, `incidentReport.ts:14-16` | Prompt-sanitization logic is **copy-pasted 4×** with divergent tag sets rather than a shared F4 util (violates the "no duplicate logic" guardrail and F4's "single sanitization path" intent). See §4.3. |
| 2.4 | MODERATE | `lib/engine/proactiveAlerts.ts` + `lib/engine/alertTriage.ts` | Two **parallel alert engines** both run every tick via `useProactiveAlerts.ts:33` (`runAlertTriageService`→`evaluateTriggers`) and `:72` (`evaluateProactiveAlerts`). Both emit exit/egress alerts in the late-game window `[5700,6300]` into the same `useAlertStore`. Near-duplicate logic; only `alertTriage` is documented for M6. Risk of redundant/overlapping alerts. |
| 2.5 | MINOR | `lib/engine/routing.ts:414` | Dead `sensory` param (dup of §1.3). |

**Clean:** No `console.log` in production paths (31 `console.warn/error` calls, all legitimate error handling). Only **one** TODO/FIXME in production (`tools.ts:437`). No `NODE_ENV`/`DEBUG`/`__DEV__` gating in production code.

---

## 3. Error-Handling Completeness

**Largely PASS.**

| # | Sev | File:Line | Finding |
|---|-----|-----------|---------|
| 3.1 | — (PASS) | `lib/ai/client.ts:46-77` | `fetchWithRetry` implements exactly-once retry (attempts<2) on 5xx / timeout / fetch errors, with per-attempt `AbortController` timeout. Used by all LLM calls. |
| 3.2 | — (PASS) | routes + agents | Safe fallbacks confirmed: `agents.ts:84,137` (`FALLBACK_RESPONSE`), `copilot.ts:106-120,183-197`, `incidentReport.ts:48-51`, `vision/route.ts:46-53,74-77`. Stress override to `critical` on parse failure (`agents.ts:74-83`). |
| 3.3 | — (PASS) | tests | Documented graceful-failure paths ARE tested: `routing.test.ts:118,247,415` (no_route/no_accessible), `destinationResolver.test.ts:143,152,196` (no_matching_poi/no_open_exit), `accessibilityRouting.test.ts:64` (M11 noRouteFound), `safeExit.test.ts:43` (M14 all-gates-closed). GodMode/scenario/stress tests exist. |
| 3.4 | MINOR | `lib/ai/client.ts:60-64` | Only `status >= 500` is retried; **4xx (incl. 429 rate-limit) is not retried**. |
| 3.5 | MINOR | doc vs `env.ts:8` | Master doc F4 claims "aborts hangs after **15s**"; code uses `LLM_TIMEOUT_MS` default **8000ms** (`env.ts`). Doc/impl mismatch. |

---

## 4. Security

| # | Sev | File:Line | Finding |
|---|-----|-----------|---------|
| 4.1 | — (PASS) | `.env`, `.gitignore:34` | **No committed secrets.** `.env` is NOT git-tracked (`git ls-files .env` empty), gitignored via `.env*`, and holds a 17-char placeholder key. No `gsk_`/`sk-`/`AIza` patterns anywhere in `lib/components/app/tests`. |
| 4.2 | — (PASS) | `lib/ai/env.ts`, `client.ts` | `LLM_PROVIDER/MODEL/API_KEY` read exclusively from `process.env` via Zod. **No hardcoded model ids** (`gemini-*`/`llama-*`/`gpt-*`/`claude-*`) in source. |
| 4.3 | MODERATE | `lib/ai/incidentReport.ts:14-32` | **Injection gap:** the user-derived `incident.note` is wrapped in `<incident>…</incident>` delimiters but sanitization only strips `<user_message>` tags — it does NOT strip `</incident>`/`<assignment>`. A note containing `</incident>` can break out of its delimiter block. Organizer-triggered + low exploitability, but the defense is incomplete vs the fan path. |
| 4.4 | MODERATE | (cross-file) | **No shared sanitization path.** F4's injection defense is reimplemented 4× (`agents.ts` strips+wraps `<user_message>`; `copilot.ts` strips `<user_message>`+`<user_query>` and wraps `<user_query>`; `incidentReport.ts` strips only `<user_message>`, wraps `<incident>`). Divergent tag handling → inconsistent coverage (root cause of 4.3). |
| 4.5 | — (PASS) | `vision/route.ts:32-43` | **M12** upload limits enforced **server-side**: Zod `.strict()`, `mimeType` enum `['image/jpeg','image/png']`, and a 5MB decoded-size check in the route (not just client UI). |
| 4.6 | — (PASS) | `app/api/assistant/route.ts:6-31` | Message `max(2000)`, strict schema, zod errors not surfaced to client. **M20** dataset validation is server-side via `uploadDatasetSchema.strict()` (`simStore.importDataset`). |
| 4.7 | MINOR | `app/api/copilot/route.ts:5-17` | Copilot route schema is **not `.strict()`** (assistant + vision routes are); extra fields silently accepted. |

---

## 5. State-Mutation Correctness

**PASS — no direct mutations found.**

| # | Sev | File:Line | Finding |
|---|-----|-----------|---------|
| 5.1 | — (PASS) | `simStore.ts` / `alertStore.ts` / `incentiveStore.ts` | All actions use immutable spreads (`setFanLocation` 451-457, `incrementRoutedLoad` 536, `fireAlert` 57-64, `dismissAlert` 69-72, `triggerSos` 542-547). `mergeStatePatch` (`engine.ts:226-237`) returns fully new objects/arrays. |
| 5.2 | — (PASS) | `channel.ts:30-36` + `simStore.ts:210-260` | All 7 message types (`STATE_SYNC/HEARTBEAT/SCENARIO/RESET/IMPORT/sos_trigger/sos_clear`) handled; unknown types rejected by whitelist. `channel.test.ts:50` proves a `BOGUS` type doesn't throw. |
| 5.3 | MINOR | `channel.ts:30-34` | Whitelist validates `msg.type` but **not payload shape**. A valid-type message with a missing/malformed body (e.g. `STATE_SYNC` with `payload: undefined`) would throw inside the `simStore` listener when it reads `msg.payload.matchClockSec`. Same-origin only → low risk. |

---

## 6. Test Quality (not just count)

Actual suite: **55 test files / 374 tests** (master doc's "29 files / 224 tests" is stale — expected, it predates M10–M20). Runtime: all pass.

| # | Sev | File:Line | Finding |
|---|-----|-----------|---------|
| 6.1 | **CRITICAL** | `lib/engine/loadBalanceSimulation.test.ts:33-103` | **The M8 headline claim is not delivered on the real venue graph, and the test was rewritten to accept this.** The master doc (§M8) claims "Gini 0.75 → 0.15, improvement ratio **5.0**, exceeding the 1.3 target." But the real-venue test at lines 87-103 now asserts `improvementRatio === toBe(1)` (i.e. **zero** load-balancing improvement) with a 15-line comment (33-47) admitting the "spread load away from one congested gate" scenario "is **no longer physically possible in this topology**." Load-balancing only demonstrably works on the synthetic mock graphs (109-172). This is precisely the "test loosened to match actual (degraded) behavior rather than spec intent" pattern — the module's core value proposition is unverified on production topology. |
| 6.2 | MODERATE | `tsc --noEmit` (test files) | **Tests are not typechecked in CI** — 8+ type errors exist only in test files (prod build passes because it excludes them): `tests/mobile.test.tsx:17` (`TicketData.id` doesn't exist), `Dashboard.test.tsx:31` (`SosState.triggeredAtSec` missing), `copilot.test.ts:78,82` (`DensityFrame.gateStatus` missing), `accessibilityRouting.test.ts:99` (`Poi.angle/r` missing), `forecast.test.ts:58-74` (`result.density` possibly undefined), `loadBalance.test.ts:120`, `sensoryRouting.test.ts:158`. Stale fixtures silently drifted from the type model. |
| 6.3 | MINOR | `loadBalanceSimulation.test.ts:71` | `console.log('[M8 QUADRANT DIVERSITY RESULTS]'...)` left in a test. |
| 6.4 | MINOR | `mapActionDispatcher.test.ts:81`, `proactiveAlerts.test.ts:135`, `channel.test.ts:26-27,50` | `.not.toThrow()` smoke assertions — acceptable as crash-guards but prove no behavior. |

---

## 7. Accessibility

| # | Sev | File:Line | Finding |
|---|-----|-----------|---------|
| 7.1 | — (PASS) | `SOSOverlay.tsx:52-56` | **M14** emergency overlay has `role="alert"` + `aria-live="assertive"` — correct for an emergency announcement. |
| 7.2 | — (PASS) | `AlertCard.tsx`, `IncentiveCard.tsx` | M6/M9 cards carry aria/role attributes (3 and 6 hits respectively). |
| 7.3 | MINOR-MOD | `components/organizer/{Dashboard,DispatchQueue,GodMode,Copilot,UploadPanel}.tsx` | Organizer panels (M16–M20) have **zero** `aria-*`/`role`/landmark attributes. Interactive controls ARE native `<button type="button">` (so keyboard/focus works), but they lack the aria-labels, `role="group/region"`, and focus management that the fan-side F1 components establish as the standard. No non-button `onClick` traps found. |

---

## 8. Performance / Efficiency Claims

| # | Sev | File:Line | Finding |
|---|-----|-----------|---------|
| 8.1 | — (PASS) | `engine.ts:209-212` | **M8** `routedLoad` decay (`×0.9`/tick via `decayRoutedLoad`) AND phase-boundary firewall (`if (currentPhase !== nextPhase) nextRoutedLoad = {}`) are wired into `tickSimulation`. |
| 8.2 | MINOR | `useProactiveAlerts.ts:38-45` | **M6 throttle is partial.** The 10-sim-second throttle guards only `evaluateProactiveAlerts` (step 3); `runAlertTriageService` (step 1) runs on **every** tick unthrottled. Cost is bounded (alertTriage only calls Dijkstra when non-routing preconditions pass, per `alertTriage.ts:43-47`), but the "throttled evaluation" claim is only half-true. |
| 8.3 | MINOR | `lib/engine/routing.ts:420-473` | `computeRoute` runs Dijkstra up to **3×** per call (primary; +accessible-recheck when `accessibleOnly` fails; +naive second-best whenever ANY zone density >0.5 OR any routedLoad>0 — i.e. almost always mid-match). Not memoized. Acceptable at current call volumes but a latent hot path. |

---

## 9. Design-System Consistency

| # | Sev | File:Line | Finding |
|---|-----|-----------|---------|
| 9.1 | MODERATE | (repo-wide) | ~41 hardcoded hex occurrences outside `tokens.ts`/`venue.ts`. Core palette matches (`#2563EB`×14, `#FAFAFA`, heatmap `#C0DD97`/`#FAC775`/`#F09595`, `#DC2626` M14 red). But **off-palette values** appear that are not in the locked token set: `#639922`, `#BA7517`, `#A32D2D`, `#534AB7`, `#3B6D11`, `#0F6E56`, `#CDE6A6`, `#9FC46A`, `#ECEAE1`, `#E4E1D8`, `#B4B2A9`, `#444441`, `#2C2C2A`, `#5F5E5A`. These are likely high-contrast heatmap/facility variants but are not declared as tokens — reconcile to the design system or document as exceptions. |
| 9.2 | MINOR | components | Spacing/radius/shadow token usage (`rounded-xl`/12px, `shadow-card`) appears consistent across fan and organizer components; no systematic drift observed. |

---

## 10. General Code Quality

| # | Sev | Finding |
|---|-----|---------|
| 10.1 | MODERATE | **`tsc --noEmit` fails** with 8+ errors — all in test files (see §6.2). Production `next build` passes (excludes tests). CI should typecheck tests. |
| 10.2 | — (PASS) | **No circular dependencies** (madge across 138 files: "No circular dependency found"). |
| 10.3 | MINOR-MOD | **Unusual runtime dependencies** in `package.json`: `@rolldown/binding-win32-x64-msvc` (a platform-locked Windows-x64 native binary as a *direct* dependency — will break installs on other OS/arch and shouldn't be a top-level dep), and `shadcn` `^4.13.0` (a CLI/scaffolding tool listed as a runtime dependency). Both warrant review. `qrcode` + `jsqr` both present intentionally (generate + scan). |
| 10.4 | MINOR | madge emitted 44 warnings (unresolved `@/…` alias imports during static scan) — cosmetic, not runtime. |

---

## Prioritized Top-15 (by actual risk)

| Rank | Sev | Ref | One-line |
|------|-----|-----|----------|
| 1 | **CRITICAL** | 6.1 | M8 load-balancer delivers **zero** herding improvement on the real venue graph (`improvementRatio === 1`); test rewritten to accept it, contradicting the doc's 5.0×/Gini-0.75→0.15 claim. |
| 2 | MODERATE | 1.1 | `routingService.computeServiceRoute` ignores persistent `fanContext.sensory` → M9 accept-reroute & M6 route silently drop the fan's sensory prefs (contradicts documented behavior). |
| 3 | MODERATE | 4.3 | `incidentReport.ts` injection gap: wraps note in `<incident>` but only strips `<user_message>`, allowing `</incident>` delimiter breakout. |
| 4 | MODERATE | 4.4 / 2.3 | No shared sanitization path — injection defense copy-pasted 4× with divergent tag handling (F4 centralization violated); root cause of #3. |
| 5 | MODERATE | 2.4 | Two parallel alert engines (`evaluateTriggers` + `evaluateProactiveAlerts`) both fire into `alertStore` → overlapping/duplicate exit alerts; only one is documented. |
| 6 | MODERATE | 1.2 | Vision route `mapActions` shape `{type:'highlightZone'}` ≠ contract `{op:'highlight'}` — would not dispatch. |
| 7 | MODERATE | 6.2 / 10.1 | Test suite not typechecked: 8+ `tsc` errors from stale fixtures (`TicketData.id`, `SosState.triggeredAtSec`, `DensityFrame.gateStatus`, `Poi.angle/r`, …). |
| 8 | MODERATE | 2.1 / 2.2 | `runOrganizerCopilot` orphaned **and** `getIncentive` is a live `__stub` tool the LLM can call — dead/stub code in AI paths. |
| 9 | MODERATE | 9.1 | Off-palette hardcoded hex colors (14+ distinct values) not reconciled to the locked design tokens. |
| 10 | MINOR-MOD | 10.3 | Suspicious runtime deps: `@rolldown/binding-win32-x64-msvc` (OS/arch-locked native binary) and `shadcn` (CLI as runtime dep). |
| 11 | MINOR-MOD | 7.3 | Organizer panels (M16–M20) lack ARIA labels/roles/landmarks vs the F1 standard (keyboard still works via native buttons). |
| 12 | MINOR | 4.7 | `/api/copilot` request schema not `.strict()` (assistant/vision are); extra fields silently accepted. |
| 13 | MINOR | 8.2 | M6 throttle covers only `evaluateProactiveAlerts`; `runAlertTriageService` runs every tick unthrottled. |
| 14 | MINOR | 3.4 / 3.5 | LLM client doesn't retry 4xx/429; doc claims 15s abort but code uses 8000ms env default. |
| 15 | MINOR | 5.3 | BroadcastChannel handler validates `msg.type` but not payload shape — a malformed same-type message could throw in the listener. |

> **Also flagged (meta):** `stadiumiq-plan.md` (the requested authoritative spec) is missing; audit ran against `STADIUMIQ-MASTER-DOCUMENTATION.md`, which only covers F1–F4 + M1–M9. Confirm the intended plan source before acting on doc-vs-code deltas.

---

*End of report. No source files were modified.*
