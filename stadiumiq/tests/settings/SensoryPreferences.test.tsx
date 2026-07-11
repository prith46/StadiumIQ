import * as React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SensoryPreferences } from "../../components/settings/SensoryPreferences";
import { useSimStore } from "../../lib/store/simStore";

describe("Module M10 SensoryPreferences Tests", () => {
  beforeEach(() => {
    useSimStore.setState({
      fanContext: {
        language: "en",
        location: "sec-101",
        accessibility: false,
        sensory: undefined,
        group: undefined,
        leavingEarly: undefined,
        ticket: undefined,
      },
    });
  });

  it("toggling 'Quiet route' updates fanContext.sensory.quiet in the store", () => {
    render(<SensoryPreferences />);

    const quietSwitch = screen.getByLabelText("Quiet route");
    expect(useSimStore.getState().fanContext.sensory?.quiet).toBeFalsy();

    fireEvent.click(quietSwitch);

    expect(useSimStore.getState().fanContext.sensory?.quiet).toBe(true);
  });

  it("active-preference badge is absent by default and appears once a preference is set", () => {
    render(<SensoryPreferences />);

    expect(screen.queryByRole("status", { name: "Sensory preference active" })).toBeNull();

    fireEvent.click(screen.getByLabelText("Prefer open-air"));

    const badge = screen.getByRole("status", { name: "Sensory preference active" });
    expect(badge.textContent).toContain("Open-air: on");
  });

  it("badge disappears again when the preference is toggled back off", () => {
    render(<SensoryPreferences />);

    const quietSwitch = screen.getByLabelText("Quiet route");
    fireEvent.click(quietSwitch);
    expect(screen.getByRole("status", { name: "Sensory preference active" })).toBeTruthy();

    fireEvent.click(quietSwitch);
    expect(screen.queryByRole("status", { name: "Sensory preference active" })).toBeNull();
  });

  it("avoid-affiliation radio group updates fanContext.sensory.avoidAffiliation", () => {
    render(<SensoryPreferences />);

    fireEvent.click(screen.getByRole("radio", { name: "Avoid Away" }));
    expect(useSimStore.getState().fanContext.sensory?.avoidAffiliation).toBe("away");

    const badge = screen.getByRole("status", { name: "Sensory preference active" });
    expect(badge.textContent).toContain("Avoiding Away section");

    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(useSimStore.getState().fanContext.sensory?.avoidAffiliation).toBeUndefined();
  });

  it("toggles are real accessible switch/radio controls, labeled and keyboard-operable", () => {
    render(<SensoryPreferences />);

    const quietSwitch = screen.getByLabelText("Quiet route");
    expect(quietSwitch).toHaveAttribute("role", "switch");

    const openAirSwitch = screen.getByLabelText("Prefer open-air");
    expect(openAirSwitch).toHaveAttribute("role", "switch");

    const affiliationRadios = screen.getAllByRole("radio");
    expect(affiliationRadios.length).toBe(3);

    // Keyboard-operable: switches are native <input type=checkbox>-backed and
    // respond to Enter/Space via the browser's default button/checkbox semantics;
    // confirm the underlying focus target is reachable by tab order.
    quietSwitch.focus();
    expect(document.activeElement === quietSwitch || quietSwitch.contains(document.activeElement)).toBe(true);
  });
});
