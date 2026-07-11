import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import HomePage from '@/app/page';
import { useSimStore } from '@/lib/store/simStore';
import { useRoleStore } from '@/lib/store/roleStore';
import { ZONES } from '@/lib/venue/venue';

describe('Mobile / Responsive Fan Layout Integration', () => {
  const originalInnerWidth = window.innerWidth;

  beforeEach(() => {
    // Force active fan session with mock location section so onboarding is skipped
    useRoleStore.getState().setRole('fan');
    useSimStore.getState().setFanLocation('sec-101');
    useSimStore.getState().setFanTicket({
      id: 'ticket-1',
      section: '101',
      row: 'A',
      seat: '1',
      gate: 'gate-a',
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

    // Map container elements must have relative position and strict aspect ratio to hold SVG matching overlays
    const mapWrapper = container.querySelector('.aspect-square');
    expect(mapWrapper).not.toBeNull();
    
    const innerWrapper = container.querySelector('.relative.w-full.max-w-\\[650px\\]');
    expect(innerWrapper).not.toBeNull();

    // Aspect ratio styling should match VIEW_W / VIEW_H (680 / 396)
    const style = (innerWrapper as HTMLElement).style;
    expect(style.aspectRatio).toBe('680 / 396');
  });
});
