import * as React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AssistantPanel } from '../../components/assistant/AssistantPanel';
import * as client from '../../lib/assistant/client';
import { StadiumMapHandle } from '../../lib/assistant/mapActionDispatcher';
import { useSimStore } from '../../lib/store/simStore';

// Mock the API client function
vi.mock('../../lib/assistant/client', () => {
  return {
    sendAssistantMessage: vi.fn(),
  };
});

// Mock prefers-reduced-motion to false
vi.mock("framer-motion", async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    useReducedMotion: () => false,
  };
});

describe('AssistantPanel Chat Component', () => {
  const mapRef: { current: StadiumMapHandle | null } = { current: null };
  const mockHighlight = vi.fn();
  const mockRoute = vi.fn();
  const mockPin = vi.fn();
  const mockClear = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(client.sendAssistantMessage).mockReset();

    mockHighlight.mockReset();
    mockRoute.mockReset();
    mockPin.mockReset();
    mockClear.mockReset();

    mapRef.current = {
      highlightZone: mockHighlight,
      drawRoute: mockRoute,
      dropPin: mockPin,
      clearOverlay: mockClear,
    };

    useSimStore.setState({
      fanContext: {
        language: 'en',
        location: 'sec-214',
        accessibility: false,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders initial empty state with quick action chips and welcome message', () => {
    render(<AssistantPanel mapRef={mapRef} />);

    expect(screen.getByText("Ask me anything about the stadium")).toBeInTheDocument();
    expect(screen.getByText("Navigate to seats, check queue status, or find nearby concessions.")).toBeInTheDocument();

    // Verify presence of all three spec quick action chips
    expect(screen.getByRole("button", { name: "Where's the nearest restroom?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "How do I get to my seat?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What's nearby?" })).toBeInTheDocument();
  });

  it('sending a message appends user bubble immediately and displays thinking state', async () => {
    vi.mocked(client.sendAssistantMessage).mockImplementation(() => {
      // Keep in flight to test thinking indicator and disabled send button
      return new Promise(() => {});
    });

    render(<AssistantPanel mapRef={mapRef} />);

    const input = screen.getByLabelText('Message the assistant');
    const sendButton = screen.getByLabelText('Send message');

    fireEvent.change(input, { target: { value: 'How is the line at Section 214?' } });
    fireEvent.click(sendButton);

    // Appended user bubble immediately
    expect(screen.getByText('How is the line at Section 214?')).toBeInTheDocument();

    // Renders three-dot pulsing thinking indicator
    expect(screen.getByLabelText('Thinking')).toBeInTheDocument();

    // Send button is disabled during query flight
    expect(sendButton).toBeDisabled();
  });

  it('clicking a quick action chip triggers direct message send', async () => {
    vi.mocked(client.sendAssistantMessage).mockImplementation(() => new Promise(() => {}));

    render(<AssistantPanel mapRef={mapRef} />);

    const chip = screen.getByRole("button", { name: "Where's the nearest restroom?" });
    fireEvent.click(chip);

    // Verify the text is added to the log region
    expect(screen.getByRole("log")).toHaveTextContent("Where's the nearest restroom?");
    expect(screen.getByLabelText('Thinking')).toBeInTheDocument();
  });

  it('successful JSON complete appends assistant bubble and dispatches map actions', async () => {
    vi.mocked(client.sendAssistantMessage).mockImplementation((req, options) => {
      options.onComplete({
        message: 'The nearest restroom is located behind **Section 214**.',
        language: 'en',
        mapActions: [{ op: 'highlight', zoneId: 'sec-214' }],
        alertLevel: 'none',
      });
      return Promise.resolve();
    });

    render(<AssistantPanel mapRef={mapRef} />);

    const input = screen.getByLabelText('Message the assistant');
    const sendButton = screen.getByLabelText('Send message');

    fireEvent.change(input, { target: { value: 'Where is the restroom?' } });
    fireEvent.click(sendButton);

    // Verify text contains formatted markdown bold element
    expect(screen.getByText('Section 214')).toHaveClass('font-bold');

    // Dispatched highlight zone operation on map handle
    expect(mockHighlight).toHaveBeenCalledWith('sec-214');

    // Thinking state is removed
    expect(screen.queryByLabelText('Thinking')).not.toBeInTheDocument();

    // Typing a new message allows the send button to be enabled (no longer in flight)
    fireEvent.change(input, { target: { value: 'Next query' } });
    expect(sendButton).not.toBeDisabled();
  });

  it('renders critical alertLevel bubbles with special border indicator styling', async () => {
    vi.mocked(client.sendAssistantMessage).mockImplementation((req, options) => {
      options.onComplete({
        message: 'Severe congestion at Gate A. Avoid entry.',
        language: 'en',
        mapActions: [],
        alertLevel: 'critical',
      });
      return Promise.resolve();
    });

    render(<AssistantPanel mapRef={mapRef} />);

    const input = screen.getByLabelText('Message the assistant');
    const sendButton = screen.getByLabelText('Send message');

    fireEvent.change(input, { target: { value: 'Is Gate A open?' } });
    fireEvent.click(sendButton);

    const bubble = screen.getByText('Severe congestion at Gate A. Avoid entry.');
    expect(bubble).toBeInTheDocument();
    expect(bubble).toHaveStyle({ borderLeft: '3px solid #F09595' });
  });

  it('renders inline retry banner on API failures and handles retry clicks', async () => {
    let callCount = 0;
    vi.mocked(client.sendAssistantMessage).mockImplementation((req, options) => {
      callCount++;
      if (callCount === 1) {
        options.onError(new Error('Network Fail'));
      } else {
        options.onComplete({
          message: 'Retried successfully!',
          language: 'en',
          mapActions: [],
          alertLevel: 'none',
        });
      }
      return Promise.resolve();
    });

    render(<AssistantPanel mapRef={mapRef} />);

    const input = screen.getByLabelText('Message the assistant');
    const sendButton = screen.getByLabelText('Send message');

    fireEvent.change(input, { target: { value: 'Check network retry' } });
    fireEvent.click(sendButton);

    // Shows error banner
    expect(screen.getByText('Something went wrong — try again')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retryBtn);

    // Retry should successfully complete
    expect(screen.getByText('Retried successfully!')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong — try again')).not.toBeInTheDocument();
  });

  it('message list contains role="log" and is accessible to screen readers', () => {
    render(<AssistantPanel mapRef={mapRef} />);
    const logRegion = screen.getByRole('log');
    expect(logRegion).toBeInTheDocument();
    expect(logRegion).toHaveAttribute('aria-live', 'polite');
  });

  it('triggers Calm Mode and auto-creates an incident when a distress message is sent', async () => {
    // Clear simulate state incidents before
    useSimStore.setState({
      incidents: [],
      matchClockSec: 500,
      fanContext: {
        language: 'en',
        location: 'sec-101',
        accessibility: false,
      },
    });

    vi.mocked(client.sendAssistantMessage).mockImplementation((req, options) => {
      options.onComplete({
        message: 'Please stay calm. 1. Exit row. 2. Proceed to Gate A.',
        language: 'en',
        mapActions: [],
        alertLevel: 'warn',
        meta: { stress: true },
      });
      return Promise.resolve();
    });

    render(<AssistantPanel mapRef={mapRef} />);

    const input = screen.getByLabelText('Message the assistant');
    const sendButton = screen.getByLabelText('Send message');

    // Send a message that triggers the stress heuristic: "help me chest pain" (chest pain is high severity)
    fireEvent.change(input, { target: { value: 'help me chest pain' } });
    fireEvent.click(sendButton);

    // Verify an incident was created in useSimStore
    const currentIncidents = useSimStore.getState().incidents;
    expect(currentIncidents.length).toBe(1);
    expect(currentIncidents[0].type).toBe('medical');
    expect(currentIncidents[0].zoneId).toBe('sec-101');
    expect(currentIncidents[0].note).toBe('help me chest pain');

    // Verify Calm Mode visual changes
    // 1. Header has "Calm Mode Active"
    expect(screen.getByText('Calm Mode Active')).toBeInTheDocument();

    // 2. Calm alert banner is rendered
    expect(screen.getByText(/On-site staff has been notified of your location/i)).toBeInTheDocument();

    // 3. Message bubble is enlarged
    const assistantBubble = screen.getByText(/Please stay calm\. 1/i);
    expect(assistantBubble).toHaveClass('text-base font-medium');

    // 4. Quick Action Chips are hidden
    expect(screen.queryByText('Find nearest exit')).not.toBeInTheDocument();
  });
});
