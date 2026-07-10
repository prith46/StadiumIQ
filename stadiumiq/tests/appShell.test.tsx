import * as React from "react"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { RoleToggle } from "@/components/RoleToggle"
import { A11yControls } from "@/components/A11yControls"
import { LoadingState } from "@/components/ui/LoadingState"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorState } from "@/components/ui/ErrorState"
import { useRoleStore } from "@/lib/store/roleStore"
import { useA11yStore } from "@/lib/store/a11yStore"

describe("StadiumIQ App Shell & Accessibility Controls", () => {
  beforeEach(() => {
    // Reset Zustand stores
    useRoleStore.setState({ role: "fan" })
    useA11yStore.setState({
      highContrast: false,
      fontScale: 1,
      ttsEnabled: false,
    })

    // Reset document element state
    if (typeof document !== "undefined") {
      document.documentElement.className = ""
      document.documentElement.style.removeProperty("--font-scale")
    }
  })

  // 1. RoleToggle renders both "Fan" and "Organizer" labels
  it('RoleToggle renders both "Fan" and "Organizer" labels', () => {
    render(<RoleToggle />)
    expect(screen.getByRole("radio", { name: /fan/i })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: /organizer/i })).toBeInTheDocument()
  })

  // 2. Clicking RoleToggle updates useRoleStore's role value from 'fan' to 'organizer'
  //    (also covers the radiogroup keyboard pattern: roving tabindex + arrow-key focus)
  it("Clicking RoleToggle updates useRoleStore's role value from 'fan' to 'organizer'", () => {
    render(<RoleToggle />)
    const organizerBtn = screen.getByRole("radio", { name: /organizer/i })
    const fanBtn = screen.getByRole("radio", { name: /fan/i })
    expect(useRoleStore.getState().role).toBe("fan")
    // aria-checked + roving tabindex reflect the store on initial render
    expect(fanBtn).toHaveAttribute("aria-checked", "true")
    expect(organizerBtn).toHaveAttribute("aria-checked", "false")
    expect(fanBtn).toHaveAttribute("tabindex", "0")
    expect(organizerBtn).toHaveAttribute("tabindex", "-1")

    fireEvent.click(organizerBtn)
    expect(useRoleStore.getState().role).toBe("organizer")
    // aria-checked + roving tabindex follow the state change (accessible selection is observable)
    expect(organizerBtn).toHaveAttribute("aria-checked", "true")
    expect(fanBtn).toHaveAttribute("aria-checked", "false")
    expect(organizerBtn).toHaveAttribute("tabindex", "0")
    expect(fanBtn).toHaveAttribute("tabindex", "-1")

    // Arrow keys move selection and focus (WAI-ARIA radiogroup pattern)
    fireEvent.keyDown(organizerBtn, { key: "ArrowLeft" })
    expect(useRoleStore.getState().role).toBe("fan")
    expect(fanBtn).toHaveAttribute("tabindex", "0")
    expect(fanBtn).toHaveFocus()

    fireEvent.keyDown(fanBtn, { key: "ArrowRight" })
    expect(useRoleStore.getState().role).toBe("organizer")
    expect(organizerBtn).toHaveFocus()
  })

  // 3. Clicking the high-contrast button in A11yControls adds the high-contrast class to document.documentElement
  it("Clicking the high-contrast button in A11yControls adds the high-contrast class to document.documentElement", () => {
    render(<A11yControls />)
    const toggleBtn = screen.getByRole("button", { name: /toggle high contrast/i })
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false)
    fireEvent.click(toggleBtn)
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true)
  })

  // 4. Clicking a font-scale button updates the --font-scale CSS variable on document.documentElement
  it("Clicking a font-scale button updates the --font-scale CSS variable on document.documentElement", () => {
    render(<A11yControls />)
    // Effect reflects the default scale onto the document root on mount.
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1")
    fireEvent.click(screen.getByRole("button", { name: "Large text size" }))
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1.15")
    // Selecting a different scale updates the variable in both directions.
    fireEvent.click(screen.getByRole("button", { name: "Normal text size" }))
    expect(document.documentElement.style.getPropertyValue("--font-scale")).toBe("1")
  })

  // 5. LoadingState, EmptyState, ErrorState each render their required text props
  it("LoadingState, EmptyState, ErrorState each render their required text props", () => {
    // 5a. LoadingState renders label
    const { unmount: unmountLoading } = render(<LoadingState label="Operations Loading..." />)
    expect(screen.getByText("Operations Loading...")).toBeInTheDocument()
    unmountLoading()

    // 5b. EmptyState renders title and description
    const { unmount: unmountEmpty } = render(
      <EmptyState title="No Alerts" description="All operations are running smoothly." />
    )
    expect(screen.getByText("No Alerts")).toBeInTheDocument()
    expect(screen.getByText("All operations are running smoothly.")).toBeInTheDocument()
    unmountEmpty()

    // 5c. ErrorState renders title and description, and handles onRetry
    const onRetrySpy = vi.fn()
    const { unmount: unmountError } = render(
      <ErrorState title="System Disconnected" description="Retrying network interface..." onRetry={onRetrySpy} />
    )
    expect(screen.getByText("System Disconnected")).toBeInTheDocument()
    expect(screen.getByText("Retrying network interface...")).toBeInTheDocument()
    
    const retryBtn = screen.getByRole("button", { name: /retry/i })
    fireEvent.click(retryBtn)
    expect(onRetrySpy).toHaveBeenCalledTimes(1)
    unmountError()
  })
})
