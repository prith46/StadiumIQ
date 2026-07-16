# M1 — Test QR Payloads

Manual-testing reference for the onboarding QR flow. Format confirmed by
reading [`lib/onboarding/qr.ts`](../lib/onboarding/qr.ts) — `parseQrPayload`
requires an exact JSON shape:

```ts
{ v: 1, type: 'seat-block', zoneId: string }
```

- `v` must be exactly `1`.
- `type` must be exactly `"seat-block"`.
- `zoneId` must be a string matching a real `Zone.id` in
  [`lib/venue/venue.ts`](../lib/venue/venue.ts) **whose `type` is `'section'`**
  (e.g. `sec-101`, not `gate-a`, `concourse-*`, or a transit node).
- The whole raw string must be ≤ 500 characters, checked *before* `JSON.parse`
  is even attempted.

## Valid payloads

```json
{"v":1,"type":"seat-block","zoneId":"sec-101"}
{"v":1,"type":"seat-block","zoneId":"sec-214"}
{"v":1,"type":"seat-block","zoneId":"sec-318"}
```

## Invalid payloads

```text
{"v":1,"type":"seat-block","zoneId":"sec-214"   <- malformed JSON (missing closing brace)
{"v":2,"type":"seat-block","zoneId":"sec-214"}  <- wrong version (v must be 1)
{"v":1,"type":"gate-entry","zoneId":"sec-214"}  <- wrong type (must be "seat-block")
{"v":1,"type":"seat-block","zoneId":"sec-999"}  <- zoneId doesn't exist in ZONES
{"v":1,"type":"seat-block","zoneId":"gate-a"}   <- zoneId exists but isn't a section
garbage-not-even-json
```

## How to actually test with these

The onboarding QR screen (`components/onboarding/QrPanel.tsx`) doesn't have a
manual paste/text-entry fallback for raw payload strings — it only offers:

1. **"Simulate Scan"** — always uses a hardcoded demo payload
   (`generateDemoQrPayload('sec-214')`) and calls `parseQrPayload` on it
   directly. Not useful for testing other payloads without editing code.
2. **"Scan with Camera"** (`components/onboarding/CameraQrScan.tsx`) — reads
   real QR images via `jsQR` against the live camera feed, then runs the
   decoded string through the same `parseQrPayload`.

To manually test any payload above **as a real scannable image**, render it
to a QR code using the same `qrcode` package the app already depends on
(no new dependency needed) and display/print it for the camera path:

```js
const QRCode = require('qrcode');
QRCode.toFile('test-qr.png', '{"v":1,"type":"seat-block","zoneId":"sec-108"}');
```

Then open the app's "Scan with Camera" flow and point the device camera at
the generated image (on a second screen or printout).

To test `parseQrPayload` directly without any UI/camera involved, see the
existing unit tests in [`lib/onboarding/qr.test.ts`](../lib/onboarding/qr.test.ts) —
they already exercise every invalid case listed above.
