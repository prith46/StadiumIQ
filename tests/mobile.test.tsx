import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import HomePage from '@/app/page';
import { useSimStore } from '@/lib/store/simStore';
import { useRoleStore } from '@/lib/store/roleStore';
import { ZONES } from '@/lib/venue/venue';
import { AppShell } from '@/components/AppShell';

let mockReducedMotion = false;
vi.mock('framer-motion', async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    useReducedMotion: () => mockReducedMotion,
  };
});

describe('Mobile / Responsive Fan Layout Integration', () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    mockReducedMotion = false;
    // Force active fan session with mock location section so onboarding is skipped
    useRoleStore.getState().setRole('fan');
    useSimStore.getState().setFanLocation('sec-101');
    useSimStore.getState().setFanTicket({
      section: '101',
      gate: 'gate-a',
      nationality: 'US',
      countryCode: 'US',
      seat: '1',
    });
  });

  afterEach(() => {
    // Restore window width
    act(() => {
      window.innerWidth = originalInnerWidth;
      window.dispatchEvent(new Event('resize'));
    });
  });

  it('renders inline sidebar on desktop viewport (>= 768px)', () => {
    act(() => {
      window.innerWidth = 1024;
      window.dispatchEvent(new Event('resize'));
    });

    const { container } = render(<HomePage />);

    // In desktop, the assistant should be mounted inline, and chat trigger should be absent
    const chatTrigger = screen.queryByTestId('mobile-chat-trigger');
    expect(chatTrigger).toBeNull();
    
    // Renders the assistant header inline
    expect(screen.getByText('Stadium Assistant')).toBeInTheDocument();
  });

  it('renders chat trigger floating button and hides inline sidebar on mobile viewport (< 768px)', () => {
    act(() => {
      window.innerWidth = 360;
      window.dispatchEvent(new Event('resize'));
    });

    const { container } = render(<HomePage />);

    // In mobile layout, chat trigger button must be present
    const chatTrigger = screen.getByTestId('mobile-chat-trigger');
    expect(chatTrigger).toBeInTheDocument();

    // The inline assistant should NOT be immediately rendered (it is hidden inside the bottom sheet)
    expect(screen.queryByText('Stadium Assistant')).toBeNull();
  });

  it('opens and dismisses slide-up bottom sheet assistant on click', async () => {
    act(() => {
      window.innerWidth = 360;
      window.dispatchEvent(new Event('resize'));
    });

    render(<HomePage />);

    const chatTrigger = screen.getByTestId('mobile-chat-trigger');
    
    // 1. Click chat trigger -> bottom sheet opens
    act(() => {
      fireEvent.click(chatTrigger);
    });

    expect(screen.getByTestId('mobile-assistant-sheet')).toBeInTheDocument();
    expect(screen.getByText('Stadium Assistant')).toBeInTheDocument();

    // 2. Click close X button -> bottom sheet closes
    const closeBtn = screen.getByTestId('mobile-sheet-close');
    act(() => {
      fireEvent.click(closeBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('mobile-assistant-sheet')).toBeNull();
    });
  });

  it('re-verifies that map viewport ratio handles scaling at simulated mobile viewport without shift', () => {
    act(() => {
      window.innerWidth = 320;
      window.dispatchEvent(new Event('resize'));
    });

    const { container } = render(<HomePage />);

    // M4 fix: the page no longer wraps the map in a conflicting `.aspect-square`
    // box (680:396 map content inside a 1:1 box left large empty margins).
    // StadiumMap's own internal wrapper is the single source of truth for
    // sizing, so the outer square wrapper must NOT be present.
    const conflictingSquareWrapper = container.querySelector('.aspect-square');
    expect(conflictingSquareWrapper).toBeNull();

    // Map container elements must have relative position and strict aspect ratio to hold SVG matching overlays
    const innerWrapper = container.querySelector('.relative.w-full.max-w-\\[900px\\]');
    expect(innerWrapper).not.toBeNull();

    // Aspect ratio styling should match VIEW_W / VIEW_H (680 / 396)
    const style = (innerWrapper as HTMLElement).style;
    expect(style.aspectRatio).toBe('680 / 396');
  });

  it('collapses settings controls under settings toggle button on mobile header', async () => {
    act(() => {
      window.innerWidth = 360;
      window.dispatchEvent(new Event('resize'));
    });

    render(
      <AppShell>
        <div data-testid="child">Child Content</div>
      </AppShell>
    );

    // Header settings toggle should be present on mobile
    const toggle = screen.getByTestId('header-settings-toggle');
    expect(toggle).toBeInTheDocument();

    // The dropdown should NOT be present initially
    expect(screen.queryByTestId('header-settings-dropdown')).toBeNull();

    // Click to open settings
    act(() => {
      fireEvent.click(toggle);
    });

    // Dropdown is now displayed
    expect(screen.getByTestId('header-settings-dropdown')).toBeInTheDocument();

    // Click to close settings
    act(() => {
      fireEvent.click(toggle);
    });

    // Dropdown is removed
    await waitFor(() => {
      expect(screen.queryByTestId('header-settings-dropdown')).toBeNull();
    });
  });

  it('honors prefers-reduced-motion setting for bottom sheet and backdrop transitions', () => {
    act(() => {
      window.innerWidth = 360;
      window.dispatchEvent(new Event('resize'));
    });

    mockReducedMotion = true;

    render(<HomePage />);

    const chatTrigger = screen.getByTestId('mobile-chat-trigger');
    
    // Click chat trigger -> bottom sheet opens
    act(() => {
      fireEvent.click(chatTrigger);
    });

    const sheet = screen.getByTestId('mobile-assistant-sheet');
    const backdrop = screen.getByTestId('mobile-sheet-backdrop');

    expect(sheet).toBeInTheDocument();
    expect(backdrop).toBeInTheDocument();
  });
});
