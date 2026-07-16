# M29 — Automatic Match Sequencer

## Purpose

A client-side state machine that automatically drives `matchClockSec` and
crowd density through pre-match ingress → live match → post-match egress on
page load, with no manual "Start" trigger — the centerpiece demo mechanic.
Reseeded on every refresh; identical across every open tab.

## Why cross-tab sync works via seed + start-time, not live broadcasting

The entire trick is in `computeSequencerState(seed, sessionStartedAtMs, nowMs)`
(`lib/simulation/matchSequencer.ts`): it is a **pure function of elapsed wall
time**. Given the same three inputs, it always returns the same
`{ phase, matchClockSec }` — on any tab, at any moment, with zero
coordination required at call time.

That means the only thing that ever needs to be synchronized across tabs is
the *starting conditions*: `{ seed, sessionStartedAtMs }`. Whichever tab
starts a session broadcasts that pair **once**, over the existing
`BroadcastChannel('stadiumiq')` (a new additive `SEQUENCER_INIT` message type
in `lib/simulation/channel.ts` — same channel, not a second one). Every other
tab that's still waiting to start (`lib/store/simStore.ts`'s
`startAutoSequencer`) picks up that message instead of generating its own
seed, and from then on independently calls `computeSequencerState` every tick
using its own `Date.now()`. No tab ever broadcasts its *live* phase/clock/
density — there's nothing to broadcast, because every tab can already derive
it locally from the shared seed + start time. This is the same
"one source of truth broadcast, others subscribe" pattern already used for
M14 SOS propagation and the existing `STATE_SYNC` message — reused, not a new
mechanism.

Concretely, in `simStore.ts`'s `startAutoSequencer`:
1. Open the shared channel and listen for `SEQUENCER_INIT` for 200ms.
2. If one arrives, adopt its `seed`/`sessionStartedAtMs` and start ticking
   from there — this is how a tab opened mid-sequence syncs to the *current*
   phase/time instead of restarting at phase 1.
3. If nothing arrives in 200ms, call `initSequencer()` (new random seed,
   `sessionStartedAtMs = Date.now()`), broadcast it once, and start ticking.

## Phase timing constants

All in `lib/simulation/matchSequencer.ts`:

| Constant | Value | Meaning |
|---|---|---|
| `PRE_MATCH_DURATION_SEC` | 120 | Pre-match ingress countdown (120 → 0) |
| `LIVE_MATCH_DURATION_SEC` | 300 | Live steady-state window |
| `EGRESS_DURATION_SEC` | 90 | Post-match egress ramp-down |
| `LIVE_PHASE_END_SEC` | 420 | `PRE + LIVE`, elapsed-seconds boundary into `'post'` |
| `POST_PHASE_END_SEC` | 510 | `LIVE_PHASE_END_SEC + EGRESS`, boundary into `'idle'` |
| `MATCH_END_ALERT_LEAD_SEC` | 60 | M6 trigger lead time before live phase ends |

`matchClockSec` is a single continuous clock: it counts **down** 120→0 during
`'pre'`, then counts **up** continuously 120→420 through `'live'` and on to
510 through `'post'`, then holds at 510 during `'idle'` — the sequencer never
auto-restarts; only a page refresh (new seed, new `sessionStartedAtMs`)
begins a new run.

## Curve design (ingress/egress)

`ingressDensityForZone`/`egressDensityForZone` give each zone its own seeded
start-delay (0–30% into the window) and fill/drain speed (0.7×–1.3×), so
zones don't move in lockstep — some fill or empty first or faster than
others, deterministically from `seed`. Egress uses a different salt
(`0x9e3779b9`, golden-ratio-derived) than ingress so a zone's draining
stagger isn't identical to its filling stagger. Both curves are smooth/
monotonic-ish ramps toward a target density (0.85), never instant jumps.

The **'live'** phase deliberately does *not* introduce a third curve system:
it reuses `lib/simulation/engine.ts`'s existing `computeBaseDensity` (read,
not modified) at a fixed representative `matchClockSec` (900 — well past that
curve's firstHalf ramp-up, i.e. its steady 0.9-density plateau), giving a
settled in-seat pattern for the 5-minute live window.

## M6 wiring (additive)

`lib/engine/alertTriage.ts`'s `TriageInput` gained one optional field,
`secondsUntilPhaseEnd`, and one new rule (Rule 0) that fires a
`'phase-ending-soon'` proactive alert when it's within
`MATCH_END_ALERT_LEAD_SEC` of the live phase ending — existing rules are
untouched. `lib/engine/alertService.ts` computes that value from the store's
`sequencerSeed`/`sequencerStartedAtMs` (via `computeSequencerState`) only when
the sequencer is running and currently `'live'`; otherwise it's `undefined`
and Rule 0 is a no-op.

## Color meaning (Fix 2, documentation only — no recompute)

The heatmap fill colors driving all of the above (pre/live/post density) are
the existing M4 ramp (`lib/venue/geometry.ts`), unchanged by M29:

| Density | Color | Meaning |
|---|---|---|
| ~0.0 | `#C0DD97` (white/pale green) | Empty |
| low-mid | green | Proper/comfortable crowd |
| ~0.5 | `#FAC775` (orange) | Mild / busy |
| ~1.0 | `#F09595` (red) | Most crowded |

A matching color-key legend is rendered on the Organizer map
(`components/organizer/Dashboard.tsx`, next to the heatmap card).

## Manual Override Decay (Fix Batch E)

Manual density and gate overrides (injected via Map Settings or Judge Upload) behave as temporary simulations that decay back into the auto-simulation over time:
- **Snapping**: On injection, the target zone's density snaps instantly to the manual value.
- **Decay**: Starting the next tick, the manual override value linearly interpolates back toward the auto-sequenced value over a window of `OVERRIDE_DECAY_SEC = 20` seconds.
- **Self-clearing**: After 20 seconds, the manual override is automatically cleaned up and the zone reverts to pure auto-sequencer control.
- **Resume Auto Button**: Serves as a manual shortcut to bypass the decay window and snap all overrides back to auto-simulation immediately.

## What was NOT touched

`lib/engine/routing.ts`, `forecast.ts`, `dispatch.ts`,
`cascadePrediction.ts`, and `rootCause.ts` are unmodified — they keep reading
`SimState` exactly as before. `applyScenario`/`reset` (M19) are unmodified;
God Mode/Judge Upload interaction with the running sequencer is explicitly
deferred to a follow-up module.
