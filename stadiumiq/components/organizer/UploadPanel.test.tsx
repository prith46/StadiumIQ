import * as React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { UploadPanel } from './UploadPanel';
import { useSimStore } from '@/lib/store/simStore';
import { ZONES } from '@/lib/venue/venue';

describe('UploadPanel React Component', () => {
  beforeEach(() => {
    // Reset Zustand store baseline before each test
    useSimStore.getState().reset(ZONES);
  });

  it('renders paste textarea and controls by default', () => {
    render(<UploadPanel />);

    expect(screen.getByTestId('upload-textarea')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Validate & Apply/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reset Baseline/i })).toBeInTheDocument();
  });

  it('renders the paste textarea and sample JSON block at a legible font size, not the previous tiny 9-10px (M16 item 13)', () => {
    render(<UploadPanel />);

    const textarea = screen.getByTestId('upload-textarea');
    expect(textarea.className).not.toMatch(/text-\[(9|10)px\]/);
    expect(textarea.className).toContain('text-sm');

    const toggleBtn = screen.getByTestId('view-sample-format-toggle');
    act(() => {
      fireEvent.click(toggleBtn);
    });

    const sampleBlock = screen.getByTestId('sample-format-block');
    const pre = sampleBlock.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.className).not.toMatch(/text-\[(9|10)px\]/);
    expect(pre!.className).toContain('text-sm');
  });

  it('toggles the view of the sample format block', () => {
    render(<UploadPanel />);

    const toggleBtn = screen.getByTestId('view-sample-format-toggle');
    expect(screen.queryByTestId('sample-format-block')).toBeNull();

    act(() => {
      fireEvent.click(toggleBtn);
    });

    expect(screen.getByTestId('sample-format-block')).toBeInTheDocument();
    expect(screen.getByText(/"sec-101": 0.45/i)).toBeInTheDocument();

    act(() => {
      fireEvent.click(toggleBtn);
    });

    expect(screen.queryByTestId('sample-format-block')).toBeNull();
  });

  it('reports specific validation error messages for malformed pasted text', () => {
    render(<UploadPanel />);

    const textarea = screen.getByTestId('upload-textarea');
    const submitBtn = screen.getByRole('button', { name: /Validate & Apply/i });

    // Invalid JSON
    act(() => {
      fireEvent.change(textarea, { target: { value: '{"density": {"sec-999": 1.5, "sec-101": -0.2}}' } });
    });

    act(() => {
      fireEvent.click(submitBtn);
    });

    // Check that specific validation errors are rendered in the warning list
    expect(screen.getByTestId('upload-error-list')).toBeInTheDocument();
    expect(screen.getByText("density['sec-999']: zone ID does not exist in venue metadata.")).toBeInTheDocument();
    expect(screen.getByText("density['sec-101']: value must be a number between 0 and 1.")).toBeInTheDocument();
  });

  it('successfully applies a valid dataset payload and displays success banner', () => {
    render(<UploadPanel />);

    const textarea = screen.getByTestId('upload-textarea');
    const submitBtn = screen.getByRole('button', { name: /Validate & Apply/i });

    const validPayload = JSON.stringify({
      density: {
        'sec-101': 0.77,
      },
      gateStatus: {
        'gate-a': 'congested',
      },
    });

    act(() => {
      fireEvent.change(textarea, { target: { value: validPayload } });
    });

    act(() => {
      fireEvent.click(submitBtn);
    });

    // Success banner is visible
    expect(screen.getByTestId('upload-success-banner')).toBeInTheDocument();
    expect(screen.getByText(/Dataset applied successfully/i)).toBeInTheDocument();

    // Verify simulation store updated reactively
    const state = useSimStore.getState();
    expect(state.density['sec-101']).toBe(0.77);
    expect(state.gateStatus['gate-a']).toBe('congested');
  });

  it('resets applied parameters on reset baseline click', () => {
    render(<UploadPanel />);

    const textarea = screen.getByTestId('upload-textarea');
    const submitBtn = screen.getByRole('button', { name: /Validate & Apply/i });
    const resetBtn = screen.getByRole('button', { name: /Reset Baseline/i });

    const validPayload = JSON.stringify({
      density: { 'sec-101': 0.77 },
    });

    act(() => {
      fireEvent.change(textarea, { target: { value: validPayload } });
      fireEvent.click(submitBtn);
    });

    expect(useSimStore.getState().density['sec-101']).toBe(0.77);

    act(() => {
      fireEvent.click(resetBtn);
    });

    // Reset clears local states and store variables
    expect(useSimStore.getState().density['sec-101']).toBe(0);
    expect(screen.queryByTestId('upload-success-banner')).toBeNull();
  });
});
