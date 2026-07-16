import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { CrowdAgentLayer } from "./CrowdAgentLayer";
import { ZONES } from "@/lib/venue/venue";

function mockMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  );
}

describe("CrowdAgentLayer", () => {
  const zoneId = ZONES.find((z) => z.type === "section")!.id;
  const density = { [zoneId]: 0.9 };

  beforeEach(() => {
    mockMatchMedia(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders nothing when the toggle is off", () => {
    render(
      <svg>
        <CrowdAgentLayer enabled={false} density={density} />
      </svg>
    );

    expect(screen.queryByTestId("crowd-agent-layer")).not.toBeInTheDocument();
  });

  it("renders nothing when prefers-reduced-motion is set, even if enabled", () => {
    mockMatchMedia(true);

    render(
      <svg>
        <CrowdAgentLayer enabled={true} density={density} />
      </svg>
    );

    expect(screen.queryByTestId("crowd-agent-layer")).not.toBeInTheDocument();
  });

  it("cancels the animation frame on unmount", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(123 as any);
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const { unmount } = render(
      <svg>
        <CrowdAgentLayer enabled={true} density={density} />
      </svg>
    );

    expect(rafSpy).toHaveBeenCalled();

    unmount();

    expect(cancelSpy).toHaveBeenCalledWith(123);
  });
});
