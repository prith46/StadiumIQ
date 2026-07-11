import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SOSOverlay } from './SOSOverlay';
import { useSimStore } from '../lib/store/simStore';

describe('SOSOverlay Component', () => {
  beforeEach(() => {
    // Reset simulation store state
    useSimStore.setState({
      sos: {
        active: false,
        triggeredBy: null,
        triggeredAtSec: 0,
      },
      fanContext: {
        language: 'en',
        location: 'sec-108',
        accessibility: false,
      },
      gateStatus: {
        'gate-a': 'open',
        'gate-b': 'open',
        'gate-c': 'open',
        'gate-d': 'open',
      },
    });
  });

  it('renders nothing when active is false', () => {
    const { container } = render(<SOSOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders emergency header and target gate when active is true', () => {
    // Activate SOS
    useSimStore.setState({
      sos: {
        active: true,
        triggeredBy: 'fan',
        triggeredAtSec: 100,
      },
    });

    render(<SOSOverlay />);

    expect(screen.getByText(/PERSONAL SOS ACTIVATED/i)).toBeInTheDocument();
    expect(screen.getByText(/Proceed to Gate/i)).toBeInTheDocument();
  });

  it('shows the Cancel button when triggered by a fan', () => {
    useSimStore.setState({
      sos: {
        active: true,
        triggeredBy: 'fan',
        triggeredAtSec: 100,
      },
    });

    render(<SOSOverlay />);

    const cancelBtn = screen.getByRole('button', { name: /Cancel SOS/i });
    expect(cancelBtn).toBeInTheDocument();

    // Clicking cancel triggers clearSos action
    fireEvent.click(cancelBtn);
    expect(useSimStore.getState().sos?.active).toBe(false);
  });

  it('does NOT show the Cancel button when triggered by the organizer', () => {
    useSimStore.setState({
      sos: {
        active: true,
        triggeredBy: 'organizer',
        triggeredAtSec: 100,
      },
    });

    render(<SOSOverlay />);

    expect(screen.queryByRole('button', { name: /Cancel SOS/i })).toBeNull();
    expect(screen.getByText(/Emergency override broadcasts cannot be dismissed locally/i)).toBeInTheDocument();
  });

  it('renders fallback stay put alert if no route can be found (all gates closed)', () => {
    useSimStore.setState({
      sos: {
        active: true,
        triggeredBy: 'fan',
        triggeredAtSec: 100,
      },
      gateStatus: {
        'gate-a': 'closed',
        'gate-b': 'closed',
        'gate-c': 'closed',
        'gate-d': 'closed',
      },
    });

    render(<SOSOverlay />);

    expect(screen.getByText(/No Evacuation Route Found/i)).toBeInTheDocument();
    expect(screen.getByText(/All stadium gates are currently congested or closed/i)).toBeInTheDocument();
  });
});
