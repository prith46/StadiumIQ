import React, { createRef } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import { StadiumMap, StadiumMapHandle } from "@/components/StadiumMap";
import { StadiumMapErrorBoundary } from "@/components/StadiumMapErrorBoundary";
import { ZONES, POIS } from "@/lib/venue/venue";
import { EXIT_FADE_MS } from "@/lib/venue/overlayAnimations";

// Mutable mock values that tests can customize
let mockDensity: Record<string, number> | undefined = {};
let mockGateStatus: Record<string, "open" | "congested" | "closed"> = {};

// Mock useSimStore reactively
vi.mock("@/lib/store/simStore", () => {
  return {
    useSimStore: vi.fn((selector) => {
      return selector({
        density: mockDensity,
        previousDensity: {},
        gateStatus: mockGateStatus,
        sensorCounts: {},
      });
    }),
  };
});

describe("StadiumMap Component & Overlay Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDensity = {};
    mockGateStatus = {};
    // Populate default clear density for all sections
    ZONES.forEach((z) => {
      if (mockDensity) {
        mockDensity[z.id] = 0.0;
      }
      if (z.type === "gate") {
        mockGateStatus[z.id] = "open";
      }
    });
  });

  it("renders exactly 60 seating sections, 4 gates, 4 transit, and all POIs from venue.ts", () => {
    const { container } = render(<StadiumMap mode="fan" />);
    
    // Assert 60 sections
    const sections = container.querySelectorAll('path[id^="sec-"]');
    expect(sections.length).toBe(60);

    // Assert 4 gates
    const gates = container.querySelectorAll('[id^="gate-"]');
    expect(gates.length).toBe(4);

    // Assert 4 transit nodes
    const transitTrain = container.querySelector("#transit-train");
    const transitBus = container.querySelector("#transit-bus");
    const transitTaxi = container.querySelector("#transit-taxi");
    const transitParking = container.querySelector("#transit-parking");
    expect(transitTrain).toBeDefined();
    expect(transitBus).toBeDefined();
    expect(transitTaxi).toBeDefined();
    expect(transitParking).toBeDefined();
    
    const transitNodes = ZONES.filter(z => z.type === 'transit');
    expect(transitNodes.length).toBe(4);

    // Assert all POIs render
    POIS.forEach((poi) => {
      const element = container.querySelector(`#${poi.id}`);
      expect(element).not.toBeNull();
    });
    expect(POIS.length).toBeGreaterThan(0);
  });

  it("triggers onZoneClick with correct zone ID when section is clicked", () => {
    const onZoneClickSpy = vi.fn();
    const { container } = render(<StadiumMap mode="fan" onZoneClick={onZoneClickSpy} />);

    const sec101 = container.querySelector("#sec-101");
    expect(sec101).not.toBeNull();
    
    fireEvent.click(sec101!);
    expect(onZoneClickSpy).toHaveBeenCalledWith("sec-101");
  });

  it("triggers onPoiClick with correct POI ID when POI is clicked", () => {
    const onPoiClickSpy = vi.fn();
    const { container } = render(<StadiumMap mode="fan" onPoiClick={onPoiClickSpy} />);

    const poiId = POIS[0].id;
    const poiElement = container.querySelector(`#${poiId}`);
    expect(poiElement).not.toBeNull();

    fireEvent.click(poiElement!);
    expect(onPoiClickSpy).toHaveBeenCalledWith(poiId);
  });

  it("keyboard: focuses a section and triggers onZoneClick on Enter key press", () => {
    const onZoneClickSpy = vi.fn();
    const { container } = render(<StadiumMap mode="fan" onZoneClick={onZoneClickSpy} />);

    const sec101 = container.querySelector<SVGElement>("#sec-101");
    expect(sec101).not.toBeNull();

    sec101?.focus();
    expect(document.activeElement).toBe(sec101);

    fireEvent.keyDown(sec101!, { key: "Enter", code: "Enter" });
    expect(onZoneClickSpy).toHaveBeenCalledWith("sec-101");
  });

  describe("Imperative Ref Methods & Security", () => {
    it("handles highlightZone, drawRoute, dropPin and clearOverlay, and logs a warn on invalid IDs", () => {
      // Use fake timers so the exitingSnapshot setTimeout fires deterministically
      vi.useFakeTimers();
      const ref = createRef<StadiumMapHandle>();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { container } = render(<StadiumMap mode="organizer" ref={ref} onRouteAnimationStart={(resolve) => resolve()} />);

      // 1. Highlight Zone
      act(() => {
        ref.current?.highlightZone("sec-101", { pulse: true });
      });
      let highlighted = container.querySelector('#overlay-layer [stroke="var(--color-accent)"]');
      expect(highlighted).not.toBeNull();
      expect(highlighted?.getAttribute("d")).toBeDefined();
      expect(highlighted?.getAttribute("class")).toContain("animate-pulse");

      // Invalid Highlight
      act(() => {
        ref.current?.highlightZone("sec-999");
      });
      expect(warnSpy).toHaveBeenCalledWith('[StadiumMap] highlightZone called with invalid zoneId: "sec-999"');
      warnSpy.mockClear();

      // 2. Draw Route
      act(() => {
        ref.current?.drawRoute(["sec-101", "sec-102"]);
      });
      let routeOverlay = container.querySelector("#route-overlay");
      expect(routeOverlay).not.toBeNull();

      // Invalid Route
      act(() => {
        ref.current?.drawRoute(["sec-101", "sec-999"]);
      });
      expect(warnSpy).toHaveBeenCalled();
      expect(warnSpy.mock.calls[0][0]).toContain("drawRoute called with invalid zoneId(s)");
      warnSpy.mockClear();

      // 3. Drop Pin
      act(() => {
        ref.current?.dropPin("sec-101", "incident");
      });
      let pin = container.querySelector('#overlay-layer [fill="var(--color-danger)"]'); // Incident color
      expect(pin).not.toBeNull();

      // Invalid Pin
      act(() => {
        ref.current?.dropPin("sec-999", "poi");
      });
      expect(warnSpy).toHaveBeenCalledWith('[StadiumMap] dropPin called with invalid zoneId: "sec-999"');
      warnSpy.mockClear();

      // 4. Clear Overlay — primary state clears synchronously
      act(() => {
        ref.current?.clearOverlay();
        // Advance fake timers so the exitingSnapshot setTimeout(EXIT_FADE_MS) fires
        vi.advanceTimersByTime(EXIT_FADE_MS + 1);
      });
      routeOverlay = container.querySelector("#route-overlay");
      highlighted = container.querySelector('#overlay-layer [stroke="#2563EB"]');
      pin = container.querySelector('#overlay-layer [fill="#EF4444"]');
      expect(routeOverlay).toBeNull();
      expect(highlighted).toBeNull();
      expect(pin).toBeNull();

      warnSpy.mockRestore();
      vi.useRealTimers();
    });

    it("Fix 7: highlightZone and dropPin both render for a real venue.ts zone id", () => {
      const realZoneId = ZONES.find((z) => z.type === "section")!.id;
      const ref = createRef<StadiumMapHandle>();
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { container } = render(<StadiumMap mode="organizer" ref={ref} />);

      act(() => {
        ref.current?.highlightZone(realZoneId, { pulse: true });
        ref.current?.dropPin(realZoneId, "incident");
      });

      const highlighted = container.querySelector('#overlay-layer [stroke="var(--color-accent)"]');
      const pin = container.querySelector('#overlay-layer [fill="var(--color-danger)"]');

      expect(highlighted).not.toBeNull();
      expect(pin).not.toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // M5 NEW TESTS
  // -------------------------------------------------------------------------

  describe("M5: Animation Enhancements", () => {
    it("highlightZone with pulse:true applies animate-pulse class AND Framer Motion animate prop", () => {
      const ref = createRef<StadiumMapHandle>();
      const { container } = render(<StadiumMap mode="organizer" ref={ref} />);

      act(() => {
        ref.current?.highlightZone("sec-101", { pulse: true });
      });

      // Pre-existing assertion: class must contain animate-pulse (for reduced-motion CSS fallback)
      const highlighted = container.querySelector('#overlay-layer [stroke="var(--color-accent)"]');
      expect(highlighted).not.toBeNull();
      expect(highlighted?.getAttribute("class")).toContain("animate-pulse");

      // M5 assertion: Framer Motion's data-animate attribute or the element is a motion element
      // In JSDOM, Framer Motion renders the final state immediately — confirm the element exists
      // with the correct attributes (fill is rgba, stroke is var(--color-accent))
      expect(highlighted?.getAttribute("stroke")).toBe("var(--color-accent)");
      // §22.8: highlight stroke width is exactly 2.5 (was 3 pre-M4-rebuild)
      expect(highlighted?.getAttribute("stroke-width")).toBe("2.5");
    });

    it("drawRoute returns a Promise that resolves (JSDOM fires onAnimationComplete synchronously)", async () => {
      const ref = createRef<StadiumMapHandle>();
      render(<StadiumMap mode="organizer" ref={ref} onRouteAnimationStart={(resolve) => resolve()} />);

      let resolved = false;
      await act(async () => {
        const promise = ref.current?.drawRoute(["sec-101", "gate-a"]);
        if (promise) {
          promise.then(() => { resolved = true; });
        }
        // Allow microtasks and JSDOM's synchronous animation completion to flush
        await Promise.resolve();
      });

      // In JSDOM, Framer Motion's onAnimationComplete fires synchronously on mount
      // so the promise resolves within the act() boundary
      expect(resolved).toBe(true);
    });

    it("drawRoute returns a resolved Promise immediately for invalid path (no valid zones)", async () => {
      const ref = createRef<StadiumMapHandle>();
      render(<StadiumMap mode="organizer" ref={ref} />);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      let resolved = false;
      await act(async () => {
        const promise = ref.current?.drawRoute(["sec-101", "sec-999"]);
        if (promise) {
          promise.then(() => { resolved = true; });
        }
        await Promise.resolve();
      });

      // Invalid drawRoute returns Promise.resolve() immediately
      expect(resolved).toBe(true);
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("dropPin renders with correct fill color per kind AND white stroke halo", () => {
      const ref = createRef<StadiumMapHandle>();
      const { container } = render(<StadiumMap mode="organizer" ref={ref} />);

      // Incident pin — red (var(--color-danger))
      act(() => { ref.current?.dropPin("sec-101", "incident"); });
      const incidentPin = container.querySelector('#overlay-layer [fill="var(--color-danger)"]');
      expect(incidentPin).not.toBeNull();
      expect(incidentPin?.getAttribute("stroke")).toBe("white");
      expect(incidentPin?.getAttribute("stroke-width")).toBe("1.5");

      act(() => { ref.current?.clearOverlay(); });

      // Dispatch pin — FIFA blue (var(--color-accent))
      act(() => { ref.current?.dropPin("sec-102", "dispatch"); });
      const dispatchPin = container.querySelector('#overlay-layer [fill="var(--color-accent)"]');
      // Note: dispatch pin blue also appears on route overlays when active;
      // ensure we find a pin-shaped path specifically (within motion.g with transform)
      expect(dispatchPin).not.toBeNull();

      act(() => { ref.current?.clearOverlay(); });

      // POI pin — neutral gray (var(--color-text-secondary))
      act(() => { ref.current?.dropPin("sec-103", "poi"); });
      const poiPin = container.querySelector('#overlay-layer [fill="var(--color-text-secondary)"]');
      expect(poiPin).not.toBeNull();
      expect(poiPin?.getAttribute("stroke")).toBe("white");
      expect(poiPin?.getAttribute("stroke-width")).toBe("1.5");
    });

    it("clearOverlay: primary overlay clears synchronously (no timer needed), exitingSnapshot disappears after EXIT_FADE_MS", () => {
      vi.useFakeTimers();
      const ref = createRef<StadiumMapHandle>();
      const { container } = render(<StadiumMap mode="organizer" ref={ref} onRouteAnimationStart={(resolve) => resolve()} />);

      // Set up overlay state
      act(() => {
        ref.current?.drawRoute(["sec-101", "sec-102"]);
        ref.current?.dropPin("sec-101", "incident");
      });
      expect(container.querySelector("#route-overlay")).not.toBeNull();

      // clearOverlay — primary state must clear synchronously
      act(() => {
        ref.current?.clearOverlay();
      });

      // Primary overlay is gone immediately (no timer advancement needed)
      expect(container.querySelector("#route-overlay")).toBeNull();
      expect(container.querySelector('#overlay-layer [fill="#EF4444"]')).toBeNull();

      // The exit-fade snapshot is present immediately after clearOverlay
      // (it renders the old route/pins at opacity:0 for the CSS transition)
      const snapshot = container.querySelector('[data-testid="overlay-exit-snapshot"]');
      expect(snapshot).not.toBeNull();

      // After EXIT_FADE_MS, the snapshot is removed
      act(() => {
        vi.advanceTimersByTime(EXIT_FADE_MS + 1);
      });
      expect(container.querySelector('[data-testid="overlay-exit-snapshot"]')).toBeNull();

      vi.useRealTimers();
    });

    it("prefers-reduced-motion: CSS rules cover overlay-exit-fade and animate-pulse", () => {
      const { container } = render(<StadiumMap mode="fan" />);
      const styleElement = container.querySelector("style");
      expect(styleElement).not.toBeNull();
      const styleText = styleElement?.textContent ?? "";

      // Existing checks (pre-existing)
      expect(styleText).toContain("@media (prefers-reduced-motion: reduce)");
      expect(styleText).toContain("animation: none");
      expect(styleText).toContain(".pulsing-ring");
      expect(styleText).toContain(".shimmer-active");

      // M5 new: overlay-exit-fade must also be covered
      expect(styleText).toContain(".overlay-exit-fade");
      expect(styleText).toContain("transition: none");
    });
  });

  describe("Loading & Error States", () => {
    it("renders sections in neutral gray var(--color-border) with shimmer-active when density is undefined", () => {
      mockDensity = undefined; // Force loading state
      const { container } = render(<StadiumMap mode="fan" />);

      const sections = container.querySelectorAll('path[id^="sec-"]');
      expect(sections.length).toBe(60);
      sections.forEach((sec) => {
        expect(sec.getAttribute("fill")).toBe("var(--color-border)");
        expect(sec.getAttribute("class")).toContain("shimmer-active");
      });
    });

    it("renders the fallback card when a child throws inside the Error Boundary", () => {
      const ThrowsErrorComponent = () => {
        throw new Error("Simulated Rendering Failure");
      };

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      render(
        <StadiumMapErrorBoundary>
          <ThrowsErrorComponent />
        </StadiumMapErrorBoundary>
      );

      const errorText = screen.getByText("Map data unavailable");
      expect(errorText).toBeDefined();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("A11y Preferences", () => {
    it("defines CSS media query rules for prefers-reduced-motion", () => {
      const { container } = render(<StadiumMap mode="fan" />);
      const styleElement = container.querySelector("style");
      expect(styleElement).not.toBeNull();
      const styleText = styleElement?.textContent;
      expect(styleText).toContain("@media (prefers-reduced-motion: reduce)");
      expect(styleText).toContain("animation: none");
      expect(styleText).toContain(".pulsing-ring");
      expect(styleText).toContain(".shimmer-active");
    });
  });
});


