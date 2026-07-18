import * as React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { OnboardingScreen } from "../../components/onboarding/OnboardingScreen";
import { useSimStore } from "../../lib/store/simStore";

// Mock prefers-reduced-motion to false by default
vi.mock("framer-motion", async (importOriginal) => {
  const original = await importOriginal<typeof import("framer-motion")>();
  return {
    ...original,
    useReducedMotion: () => false,
  };
});

const originalSetFanLocation = useSimStore.getState().setFanLocation;
const originalSetFanTicket = useSimStore.getState().setFanTicket;

describe("Module M1 Onboarding Tests", () => {
  const onCompleteSpy = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onCompleteSpy.mockClear();

    // Reset store state and restore original actions to prevent mock pollution
    useSimStore.setState({
      setFanLocation: originalSetFanLocation,
      setFanTicket: originalSetFanTicket,
      fanContext: {
        language: "en",
        location: undefined,
        accessibility: false,
        sensory: undefined,
        group: undefined,
        leavingEarly: undefined,
        ticket: undefined,
      },
      isOnboardingOverride: false,
      sensorCounts: {
        "sec-214": 0,
        "sec-108": 0,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("OnboardingScreen & Flow Components", () => {

  it("renders QR scanner onboarding screen by default", () => {
    render(<OnboardingScreen onComplete={onCompleteSpy} />);
    expect(screen.getByText("Scan QR Code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /simulate scan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /i don't have a qr code/i })).toBeInTheDocument();
  });

  it("clicking Simulate Scan sets location, runs confirmation, and moves to ticket phase", async () => {
    const setFanLocationSpy = vi.spyOn(useSimStore.getState(), "setFanLocation");
    const { container } = render(<OnboardingScreen onComplete={onCompleteSpy} />);

    // Click simulate scan
    const simulateBtn = screen.getByRole("button", { name: /simulate scan/i });
    fireEvent.click(simulateBtn);

    // Confirm animation step is shown
    expect(screen.getByText("You're in Section 214")).toBeInTheDocument();
    expect(screen.getByText("Mid Tier")).toBeInTheDocument();

    // Verify aria-live announcement region is updated
    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion?.textContent).toBe("Location set to Section 214");

    // Advance 1000ms for confirmation transition
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(setFanLocationSpy).toHaveBeenCalledWith("sec-214");

    // Should now render the Ticket Scan step
    expect(screen.getByText("Personalize Your Experience")).toBeInTheDocument();
  });

  it("block picker: allows searching, clearing filter, keyboard access, and manual select", async () => {
    render(<OnboardingScreen onComplete={onCompleteSpy} />);

    // Toggle to manual picker
    const noQrBtn = screen.getByRole("button", { name: /i don't have a qr code/i });
    fireEvent.click(noQrBtn);

    expect(screen.getByText("Find Your Section")).toBeInTheDocument();
    const filterInput = screen.getByRole("textbox", { name: /filter sections/i });

    // Type query to filter
    fireEvent.change(filterInput, { target: { value: "214" } });

    // Advance debouncer
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Check filtered elements: Section 214 is visible, other sections are filtered
    const sectionBtn = screen.getByRole("button", { name: /section 214/i });
    expect(sectionBtn).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /section 101/i })).toBeNull();

    // Test non-matching filter
    fireEvent.change(filterInput, { target: { value: "999" } });
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText("No section matches '999'")).toBeInTheDocument();
    
    // Clear filter
    const clearLink = screen.getByRole("link", { name: /clear filter/i });
    fireEvent.click(clearLink);
    expect(filterInput).toHaveValue("");

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Select row sets location
    const targetBtn = screen.getByRole("button", { name: /section 214/i });
    
    // Keyboard: focuses and Enter trigger works
    targetBtn.focus();
    expect(targetBtn).toHaveFocus();
    fireEvent.keyDown(targetBtn, { key: "Enter" });

    // Confirm transitions to animation
    expect(screen.getByText("You're in Section 214")).toBeInTheDocument();
    
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText("Personalize Your Experience")).toBeInTheDocument();
  });

  it("ticket card: skips successfully and calls onComplete", () => {
    const setFanTicketSpy = vi.spyOn(useSimStore.getState(), "setFanTicket");
    render(<OnboardingScreen onComplete={onCompleteSpy} />);

    // Skip location block step directly to ticket
    fireEvent.click(screen.getByRole("button", { name: /simulate scan/i }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Ticket Step renders. Clicking skip calls onComplete immediately
    const skipBtn = screen.getByRole("button", { name: /skip/i });
    fireEvent.click(skipBtn);
    expect(onCompleteSpy).toHaveBeenCalledTimes(1);
    expect(setFanTicketSpy).not.toHaveBeenCalled();
  });

  it("ticket card: allows scanning ticket with rotation", async () => {
    const setFanTicketSpy = vi.spyOn(useSimStore.getState(), "setFanTicket");

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            message: "Ticket processed successfully.",
            language: "pt",
            ticket: {
              section: "sec-214",
              gate: "gate-b",
              nationality: "Brazil",
              countryCode: "BR",
              seat: "14",
            },
            mapActions: [],
            alertLevel: "none",
            meta: { tool: "vision-ticket" },
          }),
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    render(<OnboardingScreen onComplete={onCompleteSpy} />);

    // Skip location block step directly to ticket
    fireEvent.click(screen.getByRole("button", { name: /simulate scan/i }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const scanBtn = screen.getByRole("button", { name: /scan match ticket/i });
    fireEvent.click(scanBtn);

    // Spinner is shown during 800ms scan duration
    expect(screen.getByText("Reading ticket code...")).toBeInTheDocument();

    // Resolve the async fetch and flush microtasks
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Rotation test (first mock ticket data is sec-214)
    expect(setFanTicketSpy).toHaveBeenCalledWith({
      section: "sec-214",
      gate: "gate-b",
      nationality: "Brazil",
      countryCode: "BR",
      seat: "14",
    });
    expect(onCompleteSpy).toHaveBeenCalledTimes(1);
  });

  it("error state: forced store-write throw displays error banner with functioning retry", () => {
    // Force setFanLocation to throw an error
    useSimStore.setState({
      setFanLocation: () => {
        throw new Error("Store Write Failed");
      },
    });

    render(<OnboardingScreen onComplete={onCompleteSpy} />);

    // Click simulate scan
    fireEvent.click(screen.getByRole("button", { name: /simulate scan/i }));

    // Let animation step trigger store call
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Error banner should show and reset to first step
    expect(screen.getByText("Couldn't set your location — try again")).toBeInTheDocument();
    expect(screen.getByText("Scan QR Code")).toBeInTheDocument();

    // Click retry
    const retryBtn = screen.getByRole("button", { name: /retry/i });
    
    // Restore mock to make store set pass
    useSimStore.setState({
      setFanLocation: (zoneId) => {
        useSimStore.setState({
          fanContext: {
            ...useSimStore.getState().fanContext,
            location: zoneId,
          },
        });
      },
    });

    fireEvent.click(retryBtn);

    // Let confirmation check proceed
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // Success: reaches ticket scan page
    expect(screen.getByText("Personalize Your Experience")).toBeInTheDocument();
  });
});

describe("Zustand Onboarding Actions (setFanLocation & heartbeat)", () => {
  it("increment/decrement counts without double counting and trigger heartbeat", () => {
    useSimStore.setState({
      sensorCounts: { "sec-214": 0, "sec-108": 0 },
      fanContext: {
        language: "en",
        location: undefined,
        accessibility: false,
      },
    });

    const heartbeatSpy = vi.spyOn(useSimStore.getState(), "heartbeat");

    // Select first section
    useSimStore.getState().setFanLocation("sec-214");
    expect(useSimStore.getState().fanContext.location).toBe("sec-214");
    expect(useSimStore.getState().sensorCounts["sec-214"]).toBe(1);
    expect(heartbeatSpy).toHaveBeenCalledTimes(1);
    expect(heartbeatSpy).toHaveBeenCalledWith("sec-214");

    // Change to second section
    useSimStore.getState().setFanLocation("sec-108");
    expect(useSimStore.getState().fanContext.location).toBe("sec-108");
    expect(useSimStore.getState().sensorCounts["sec-214"]).toBe(0);
    expect(useSimStore.getState().sensorCounts["sec-108"]).toBe(1);
    expect(heartbeatSpy).toHaveBeenCalledTimes(2);
    expect(heartbeatSpy).toHaveBeenLastCalledWith("sec-108");
  });
});
});
