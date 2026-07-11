# M9 — Smart Bribe Incentives

Smart Bribe Incentives convert crowd-safety bottlenecks at exit gates into concession revenue opportunities. When a crowd bottleneck is detected at an exit gate, the system generates a personalized, time-limited incentive offering a reward (e.g., concession discounts) for rerouting through a load-balance-favorable alternative gate.

---

## Core Operations

1. **Bottleneck Detection**:
   - Watches exit gates for high congestion:
     - Real-world density: $\text{Density} \ge 0.67$.
     - AND either live gate status is `'congested'` OR virtual predictive load (`routedLoad`) is elevated.
     - **Elevated Load Trigger**: Virtual load is $> 1.5\times$ the mean gate load of all open gates AND is $\ge 2$.
2. **Alternative Gate Selection**:
   - Queries open, non-congested gates.
   - Leverages M8's `routedLoadPenalty` to pick the gate with the lowest virtual load (least herding load).
3. **Personalization**:
   - Recommends concession rewards near the target alternative gate (e.g., `"10% off at concession near Gate B"`).
4. **Time-Limited Expiry**:
   - Active incentives include an `expiresAt` simulation timestamp. The default expiry duration is **600 seconds (10 minutes)**.
5. **Deterministic Payloads & Prevention**:
   - Stable ID: `incentive-${fromZone}-${toZone}-${Math.floor(matchClockSec/60)}` to prevent duplicates.
   - QR Payload: Encodes `v: 1`, `type: 'incentive'`, `from`, `to`, and `reward` as a JSON string under 500 bytes. Compatible with M1's `parseIncentivePayload` security check.

---

## Technical Specifications

### `lib/engine/smartBribe.ts`

```typescript
export interface SmartBribeInput {
  matchClockSec: number;
  density: Record<string, number>;
  gateStatus: Record<string, 'open'|'congested'|'closed'>;
  routedLoad: Record<string, number>;
  fanContext: FanContext;
  activeIncentiveIds: Set<string>;
  expiryDurationSec?: number;
}

export function evaluateSmartBribe(input: SmartBribeInput): Incentive[];
export function buildIncentiveQrPayload(incentive: Incentive): string;
```

---

## Boundaries & Out of Scope

- **No Redemption Backend**: Payment and coupon redemption flows are cosmetic/template-based only.
- **Scan Integration**: While the QR payload format structurally mirrors M1's scanning format, actual physical scanning flow integration is out of scope.
