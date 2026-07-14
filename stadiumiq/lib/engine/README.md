# `lib/engine/` — deterministic decision engine

This directory holds the deterministic logic that makes StadiumIQ's real-world
decisions (routes, ETAs, forecasts, dispatch, load-balancing, triage). The LLM
never computes any of these — it only narrates numbers this engine produces.

The directory contains **two kinds of module**, kept apart by naming convention:

## Pure functions (default — everything except `*Service.ts`)

Pure, synchronous, side-effect-free functions. **No `react`, `zustand`,
`next`, or network imports.** All live state (density, gateStatus, routedLoad,
timeline, …) is passed in explicitly as arguments, which makes them trivially
unit-testable with fixture data.

Examples: `routing.ts`, `destinationResolver.ts`, `flowVectors.ts`,
`forecast.ts`, `dispatch.ts`, `loadBalance.ts`, `cascadePrediction.ts`,
`staffPrepositioning.ts`, `rootCause.ts`, `alertTriage.ts`,
`incentiveTriage.ts`, `facilities.ts`, `forecastConfidence.ts`,
`overrideDecay.ts`, `safeExit.ts`, `sensoryFilters.ts`, `stressEscalation.ts`,
`agentMotion.ts`, `debriefData.ts`.

## Store-coupled orchestrators (`*Service.ts` — the wiring layer)

`alertService.ts`, `incentiveService.ts`, and `routingService.ts` are the thin
orchestration layer that reads/writes the Zustand stores (`useSimStore`,
`useAlertStore`, `useIncentiveStore`) and calls the pure `*Triage`/routing
functions above. They are **not** pure and are **not** unit-testable in
isolation without the store — that is by design: they exist only to bridge the
pure engine to live client state.

**Rule of thumb:** if a file imports a store, it is a `*Service.ts` orchestrator;
otherwise it is a pure function. New deterministic logic should go in a pure
module and be consumed by a service, never the other way around.
