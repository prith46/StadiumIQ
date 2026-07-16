import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChangeSeatControl } from "../../components/onboarding/ChangeSeatControl";
import { useSimStore } from "../../lib/store/simStore";

describe("Fix 2 — ChangeSeatControl (M1: a way back to onboarding)", () => {
  it("renders nothing when no location is set", () => {
    useSimStore.setState({
      fanContext: { ...useSimStore.getState().fanContext, location: undefined },
    });

    const { container } = render(<ChangeSeatControl onChangeSeat={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the current section and invokes onChangeSeat when clicked, once a location is set", () => {
    useSimStore.setState({
      fanContext: { ...useSimStore.getState().fanContext, location: "sec-214" },
    });

    const onChangeSeat = vi.fn();
    render(<ChangeSeatControl onChangeSeat={onChangeSeat} />);

    expect(screen.getByText("Section 214")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /change/i }));
    expect(onChangeSeat).toHaveBeenCalledTimes(1);
  });
});
