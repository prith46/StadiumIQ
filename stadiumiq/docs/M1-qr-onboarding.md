# M1 Onboarding: QR Location Onboarding

This document specifies the technical design, contracts, security rules, and components of the fan onboarding flow.

---

## 1. Goal & Flow Overview
The onboarding flow allows fans to set their active location (`FanContext.location`) immediately upon opening the application without filling out forms.
- **First Load**: If `location` is unset in the store, the user is presented with the onboarding screen.
- **Seat QR Scan**: Fans scan a seat block QR code (or click "Simulate Scan" in the browser demo) which yields a serialized JSON payload containing the section ID.
- **Fallback Picker**: Tapping "I don't have a QR code" opens a searchable grid of all 60 sections grouped by tier and stand.
- **Optional Ticket Scan**: Once the location is set, fans can optionally scan their match ticket (mocked) to seed ticket metadata (`nationality`, `countryCode`, etc.).
- **Main View**: Either scan or skip proceeds to the main Fan view.

---

## 2. Context & Data Shapes
Context types are defined canonically in [`lib/types.ts`](file:///e:/StadiumIQ/stadiumiq/lib/types.ts). 

### FanContext
```ts
export interface FanContext {
  language: string;            // Default 'en' (not changed by M1)
  location?: string;           // Selected zoneId (e.g. "sec-214")
  accessibility: boolean;      // Default false
  sensory?: {
    quiet?: boolean;
    openAir?: boolean;
    avoidAffiliation?: 'home' | 'away';
  };
  group?: 'solo' | 'family' | 'group';
  leavingEarly?: boolean;
  ticket?: TicketData;         // Populated via ticket-onboarding
}
```

### TicketData
```ts
export interface TicketData {
  section: string;
  gate: string;
  nationality: string;
  countryCode: string;
  seat?: string;
}
```

---

## 3. QR Code Payload Schema
QR codes printed in the stadium encode a JSON object:
```json
{
  "v": 1,
  "type": "seat-block",
  "zoneId": "sec-214"
}
```

### Pure Validation Function
Located in [`lib/onboarding/qr.ts`](file:///e:/StadiumIQ/stadiumiq/lib/onboarding/qr.ts):
```ts
export function parseQrPayload(raw: string): { zoneId: string } | null;
```

### Security Verification Rules
1. **Size check**: Raw payloads exceeding `500 bytes` are rejected immediately before `JSON.parse` to mitigate parser overflow exploits.
2. **Schema constraints**: Enforces exact match on `v === 1` and `type === "seat-block"`.
3. **Location mapping validation**: `zoneId` must correspond to a valid entry in `ZONES` and have `type === "section"`.

---

## 4. Single Trusted Path Rule
To enforce robust access security, **both simulated QR scans and manual block picker grids** route their inputs through the validation logic in `parseQrPayload` before calling `setFanLocation(zoneId)`. No component is permitted to write location values directly to the store without this validation step.

---

## 5. Mock Ticket Rotation (M12 placeholder)
The "Scan Match Ticket" button simulates processing of a ticket QR code. On click, it runs an 800ms spinner and returns one of three mock datasets round-robin:
1. Brazil (`sec-214`, `gate-b`, Seat `14`)
2. France (`sec-108`, `gate-a`, Seat `22`)
3. Japan (`sec-305`, `gate-d`, Seat `7`)

> [!NOTE]
> **TODO(M12)**: In Module M12 (Auto-Language), this mock will be replaced by a real vision API call to `/app/api/vision` to scan and translate tickets via OCR.

---

## 6. Re-onboarding Interaction
Re-onboarding is supported at any time by clicking the **"Change"** button on the `ChangeSeatControl` in the persistent header. This triggers `setIsOnboardingOverride(true)`, causing the onboarding overlay screen to appear without clearing the current location, allowing fans to safely pick a new section without losing their active location in the background.
