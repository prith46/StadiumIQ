import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { FlowVectorOverlay } from "./FlowVectorOverlay";
import { ZONES } from "@/lib/venue/venue";
import { FlowVector } from "@/lib/engine/flowVectors";

function renderOverlay(flowVectors: FlowVector[]) {
  return render(
    <svg>
      <FlowVectorOverlay flowVectors={flowVectors} zones={ZONES} />
    </svg>
  );
}

describe("FlowVectorOverlay", () => {
  it("renders the correct number of arrow elements for given flowVectors", () => {
    const [zoneA, zoneB] = ZONES;
    const flowVectors: FlowVector[] = [
      { edgeId: `${zoneA.id}->${zoneB.id}`, from: zoneA.id, to: zoneB.id, magnitude: 0.5 },
    ];

    renderOverlay(flowVectors);

    expect(screen.getAllByTestId("flow-vector-arrow")).toHaveLength(1);
  });

  it("renders zero arrows for an empty array", () => {
    renderOverlay([]);

    expect(screen.queryAllByTestId("flow-vector-arrow")).toHaveLength(0);
    expect(screen.queryByTestId("flow-vector-layer")).not.toBeInTheDocument();
  });
});
