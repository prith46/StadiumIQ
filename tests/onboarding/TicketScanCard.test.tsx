import * as React from "react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TicketScanCard } from "../../components/onboarding/TicketScanCard";
import { useSimStore } from "../../lib/store/simStore";

describe("TicketScanCard Unit Tests", () => {
  const onScanCompleteSpy = vi.fn();
  const onSkipSpy = vi.fn();

  beforeEach(() => {
    onScanCompleteSpy.mockClear();
    onSkipSpy.mockClear();
    useSimStore.setState({
      fanContext: {
        language: "en",
        location: undefined,
        accessibility: false,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handles a successful ticket scan via mocked fetch", async () => {
    const setFanLanguageSpy = vi.spyOn(useSimStore.getState(), "setFanLanguage");

    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            message: "Ticket processed successfully.",
            language: "ja",
            ticket: {
              section: "sec-305",
              gate: "gate-d",
              nationality: "Japan",
              countryCode: "JP",
              seat: "7",
            },
            mapActions: [],
            alertLevel: "none",
            meta: { tool: "vision-ticket" },
          }),
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    render(<TicketScanCard onScanComplete={onScanCompleteSpy} onSkip={onSkipSpy} />);

    const scanBtn = screen.getByRole("button", { name: /scan match ticket/i });
    fireEvent.click(scanBtn);

    // Scanner loading text should appear
    expect(screen.getByText("Reading ticket code...")).toBeInTheDocument();

    // Wait for the async fetch call and promise chain to resolve
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Verification
    expect(setFanLanguageSpy).toHaveBeenCalledWith("ja");
    expect(onScanCompleteSpy).toHaveBeenCalledWith({
      section: "sec-305",
      gate: "gate-d",
      nationality: "Japan",
      countryCode: "JP",
      seat: "7",
    });
  });

  it("handles a vision-unsupported or error response gracefully", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            message: "Vision services are currently unavailable.",
            language: "en",
            mapActions: [],
            alertLevel: "none",
            meta: { tool: "vision-unavailable" },
          }),
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    render(<TicketScanCard onScanComplete={onScanCompleteSpy} onSkip={onSkipSpy} />);

    const scanBtn = screen.getByRole("button", { name: /scan match ticket/i });
    fireEvent.click(scanBtn);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Error banner should be rendered in the UI
    expect(
      screen.getByText("Vision services are currently unavailable.")
    ).toBeInTheDocument();
    expect(onScanCompleteSpy).not.toHaveBeenCalled();
  });

  it("handles a non-ok fetch response status gracefully", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Internal server error" }),
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    render(<TicketScanCard onScanComplete={onScanCompleteSpy} onSkip={onSkipSpy} />);

    const scanBtn = screen.getByRole("button", { name: /scan match ticket/i });
    fireEvent.click(scanBtn);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Error banner should be rendered in the UI
    expect(
      screen.getByText(/Failed to scan ticket/i)
    ).toBeInTheDocument();
    expect(onScanCompleteSpy).not.toHaveBeenCalled();
  });

  it("handles a malformed JSON response gracefully without throwing", async () => {
    const mockFetch = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
      })
    );
    vi.stubGlobal("fetch", mockFetch);

    render(<TicketScanCard onScanComplete={onScanCompleteSpy} onSkip={onSkipSpy} />);

    const scanBtn = screen.getByRole("button", { name: /scan match ticket/i });
    fireEvent.click(scanBtn);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Error banner should be rendered in the UI
    expect(
      screen.getByText(/Unexpected token/i)
    ).toBeInTheDocument();
    expect(onScanCompleteSpy).not.toHaveBeenCalled();
  });
});
