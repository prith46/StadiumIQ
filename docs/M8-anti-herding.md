# M8 — Anti-Herding Load-Balancer

The Anti-Herding Load-Balancer distributes routing recommendations across the stadium gates/exits using `routedLoad` (virtual load from prior recommendations). This prevents StadiumIQ's own navigation advice from backfiring and herding large volumes of fans toward a single gate, causing a new artificial crush.

## Key Features

1. **Virtual Congestion Penalty**: Incorporates `routedLoad[gate]` as a predictive, virtual load in addition to real-time `density` during route weight calculation.
2. **Exponential Decay Policy**: Decays virtual loads by `0.9` per simulation tick. This ensures that recommendations do not bias routing indefinitely after the fans have exited.
3. **Phase Boundary Reset**: Clears all virtual loads completely when transition boundaries occur (e.g., first half to halftime), resetting the feedback loop.
4. **Commits vs. Explorations**: Differentiates between:
   - **Real Commits**: Calls `incrementRoutedLoad` when a fan successfully receives a final computed route (e.g., via M2 assistant or M3 navigation panels).
   - **Exploratory Queries**: Avoids modifying `routedLoad` during hypothetical route calculations (e.g., M6 proactive alerts looking up alternative gate times).

---

## Technical Specifications

### `lib/engine/loadBalance.ts`

```typescript
export interface LoadBalanceInput {
  routedLoad: Record<string, number>;
  gateId: string;
}

export function routedLoadPenalty(routedLoad: Record<string, number>, gateId: string): number;
export function incrementRoutedLoad(routedLoad: Record<string, number>, gateId: string): Record<string, number>;
export function decayRoutedLoad(routedLoad: Record<string, number>, decayFactor?: number): Record<string, number>;
```

---

## Mathematical Formulations

### 1. Congestion Factor & Penalty
The virtual penalty for any given gate is calculated as:
$$\text{Penalty} = 0.15 \times \min(\text{routedLoad}_{\text{gate}}, 10)$$

This is integrated into M3's pathfinding cost function `congestionFactor()` in `lib/engine/routing.ts`:
$$\text{CongestionFactor} = 1 + 2.5 \times \text{density} + \text{Penalty}$$

The capping limit ($\min(\text{routedLoad}, 10)$) ensures that a heavily congested gate does not accumulate an unbounded penalty, preventing overcorrection and avoiding sending fans on pathologically long detours.

### 2. Decay Rate
At each simulation tick, the virtual load decays exponentially:
$$\text{routedLoad}_{\text{next}} = \text{routedLoad} \times 0.9$$
Any gate whose load falls below `0.01` is pruned/removed from the state.

---

## Topology Constraints

Under the single-ring topology, cross-gate route diversity is geographically constrained. Moving around the concentric Stands ring to reach an alternate gate has a high physical distance penalty. 

Therefore, load-balancing rerouting (spillover) only occurs when fans are located near quadrant boundaries where multiple exit gates present genuinely comparable base walk times. Fans situated deep inside a stand quadrant will still be directed to their nearest gate as the physical distance delta outweighs the maximum possible congestion penalty.
