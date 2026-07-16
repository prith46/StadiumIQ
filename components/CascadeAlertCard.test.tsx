import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { CascadeAlertCard } from "./CascadeAlertCard";
import type { Cascade } from "@/lib/engine/cascadePrediction";

describe("CascadeAlertCard", () => {
  it("renders chain text correctly", () => {
    const cascades: Cascade[] = [
      {
        chain: [
          { zoneId: "gate-b", predictedCrossingSec: 300, triggerZoneId: null },
          { zoneId: "sec-101", predictedCrossingSec: 780, triggerZoneId: "gate-b" },
        ],
      },
    ];

    render(<CascadeAlertCard cascades={cascades} currentSec={0} />);

    expect(screen.getByTestId("cascade-alert-card")).toHaveTextContent(
      "Gate B (5 min) → 101 (13 min)"
    );
  });

  it("renders nothing for an empty array", () => {
    const { container } = render(<CascadeAlertCard cascades={[]} currentSec={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
