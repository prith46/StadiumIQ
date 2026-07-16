import * as React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CascadeAlertSummary } from "./CascadeAlertSummary";
import { Cascade } from "@/lib/engine/cascadePrediction";

const mockCascades: Cascade[] = [
  {
    chain: [
      { zoneId: "gate-a", predictedCrossingSec: 120, triggerZoneId: null },
      { zoneId: "concourse-n", predictedCrossingSec: 240, triggerZoneId: "gate-a" },
    ],
  },
  {
    chain: [
      { zoneId: "gate-b", predictedCrossingSec: 180, triggerZoneId: null },
      { zoneId: "concourse-s", predictedCrossingSec: 300, triggerZoneId: "gate-b" },
    ],
  },
];

describe("CascadeAlertSummary Component Tests", () => {
  it("renders nothing for empty array", () => {
    const { container } = render(<CascadeAlertSummary cascades={[]} currentSec={0} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders single CascadeAlertCard directly for array of length 1", () => {
    render(<CascadeAlertSummary cascades={[mockCascades[0]]} currentSec={0} />);
    
    // Proves direct card renders, check for absence of summary count header
    expect(screen.queryByTestId("cascade-alert-summary")).toBeNull();
    expect(screen.getByTestId("cascade-alert-card")).toBeDefined();
  });

  it("renders coalesced summary with correct count for array length > 1 and supports clearing all", () => {
    render(<CascadeAlertSummary cascades={mockCascades} currentSec={0} />);

    // Proves summary chrome is present with correct count
    const summaryCard = screen.getByTestId("cascade-alert-summary");
    expect(summaryCard).toBeDefined();
    expect(screen.getByText("2 Active Cascades")).toBeDefined();
    
    // Cards inside it should be collapsed by default
    expect(screen.queryByTestId("cascade-alert-card")).toBeNull();

    // Click expand
    const toggleBtn = screen.getByTestId("toggle-summary-btn");
    fireEvent.click(toggleBtn);

    // Cards should now be visible
    expect(screen.getAllByTestId("cascade-alert-card")).toHaveLength(2);

    // Click Clear All
    const clearAllBtn = screen.getByTestId("clear-all-cascades-btn");
    fireEvent.click(clearAllBtn);

    // Entire summary card and child cards should disappear
    expect(screen.queryByTestId("cascade-alert-summary")).toBeNull();
    expect(screen.queryByTestId("cascade-alert-card")).toBeNull();
  });
});
