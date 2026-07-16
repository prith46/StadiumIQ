import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { toSpeechLocaleTag } from "./languageTags";
import { createSpeechRecognizer } from "./speechRecognition";
import { speak, stopSpeaking, isSpeechSynthesisSupported } from "./speechSynthesis";
import { VoiceInputButton } from "../../components/VoiceInputButton";

describe("Voice In & Out Locale Tags", () => {
  it("maps BCP-47 language codes to Speech API locales", () => {
    expect(toSpeechLocaleTag("pt")).toBe("pt-BR");
    expect(toSpeechLocaleTag("es")).toBe("es-MX");
    expect(toSpeechLocaleTag("en")).toBe("en-US");
    expect(toSpeechLocaleTag("ja")).toBe("ja-JP");
    expect(toSpeechLocaleTag("ko")).toBe("ko-KR");
  });

  it("gracefully falls back to en-US for unrecognized language codes", () => {
    expect(toSpeechLocaleTag("xyz")).toBe("en-US");
    expect(toSpeechLocaleTag("")).toBe("en-US");
  });
});

describe("SpeechRecognition API Wrapper", () => {
  afterEach(() => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    vi.restoreAllMocks();
  });

  it("returns null if SpeechRecognition is unsupported", () => {
    const recognizer = createSpeechRecognizer("en-US", vi.fn(), vi.fn());
    expect(recognizer).toBeNull();
  });

  it("accumulates finalized transcript across pauses instead of discarding it (Fix 6)", () => {
    let onresultCallback: (event: any) => void = () => {};

    function mockResult(transcript: string, isFinal: boolean) {
      return Object.assign([{ transcript }], { isFinal });
    }

    const MockSpeechRecognition = vi.fn().mockImplementation(function () {
      return {
        start: vi.fn(),
        stop: vi.fn(),
        continuous: false,
        interimResults: false,
        lang: "",
        set onresult(cb: any) {
          onresultCallback = cb;
        },
      };
    });
    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);

    const onResult = vi.fn();
    createSpeechRecognizer("en-US", onResult, vi.fn());

    // First utterance finalizes at index 0 ("hello ").
    onresultCallback({
      resultIndex: 0,
      results: [mockResult("hello ", true)],
    });
    expect(onResult).toHaveBeenLastCalledWith({ transcript: "hello", isFinal: true });

    // User pauses, then starts a new phrase — the browser only reports the
    // NEW result (index 1) since index 0 is already final and won't repeat.
    onresultCallback({
      resultIndex: 1,
      results: [mockResult("hello ", true), mockResult("world", false)],
    });
    expect(onResult).toHaveBeenLastCalledWith({ transcript: "hello world", isFinal: false });
  });

  it("initializes, starts, and stops the mocked SpeechRecognition API correctly", () => {
    const mockStart = vi.fn();
    const mockStop = vi.fn();

    const MockSpeechRecognition = vi.fn().mockImplementation(function() {
      return {
        start: mockStart,
        stop: mockStop,
        continuous: false,
        interimResults: false,
        lang: "",
      };
    });

    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);

    const onResult = vi.fn();
    const onError = vi.fn();
    const recognizer = createSpeechRecognizer("pt-BR", onResult, onError);

    expect(recognizer).not.toBeNull();
    recognizer?.start();
    expect(mockStart).toHaveBeenCalledTimes(1);

    recognizer?.stop();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });
});

describe("SpeechSynthesis API Wrapper", () => {
  const originalSpeechSynthesis = typeof window !== "undefined" ? window.speechSynthesis : undefined;

  afterEach(() => {
    if (originalSpeechSynthesis) {
      vi.stubGlobal("speechSynthesis", originalSpeechSynthesis);
    } else {
      vi.stubGlobal("speechSynthesis", undefined);
    }
    vi.restoreAllMocks();
  });

  it("detects SpeechSynthesis support correctly", () => {
    vi.stubGlobal("speechSynthesis", undefined);
    expect(isSpeechSynthesisSupported()).toBe(false);

    vi.stubGlobal("speechSynthesis", {});
    expect(isSpeechSynthesisSupported()).toBe(true);
  });

  it("configures SpeechSynthesisUtterance correctly and cancel active speech", () => {
    const mockCancel = vi.fn();
    const mockSpeak = vi.fn();

    vi.stubGlobal("speechSynthesis", {
      cancel: mockCancel,
      speak: mockSpeak,
    });

    const mockUtterance = vi.fn();
    vi.stubGlobal("SpeechSynthesisUtterance", mockUtterance);

    const spoke = speak("Hello stadium", "en-US");

    expect(spoke).toBe(true);
    expect(mockCancel).toHaveBeenCalledTimes(1);
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockUtterance).toHaveBeenCalledWith("Hello stadium");

    stopSpeaking();
    expect(mockCancel).toHaveBeenCalledTimes(2);
  });
});

describe("VoiceInputButton Component Tests", () => {
  afterEach(() => {
    vi.stubGlobal("SpeechRecognition", undefined);
    vi.stubGlobal("webkitSpeechRecognition", undefined);
    vi.restoreAllMocks();
  });

  it("renders absolutely nothing if SpeechRecognition is unsupported", () => {
    const { container } = render(<VoiceInputButton onTranscript={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the mic trigger button when SpeechRecognition is supported", () => {
    const MockSpeechRecognition = vi.fn().mockImplementation(() => ({
      start: vi.fn(),
      stop: vi.fn(),
    }));
    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);

    render(<VoiceInputButton onTranscript={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /voice input/i });
    expect(btn).toBeInTheDocument();
  });

  it("handles mic toggles, showing a pulsing aura and listening status", async () => {
    const mockStart = vi.fn();
    const mockStop = vi.fn();

    const MockSpeechRecognition = vi.fn().mockImplementation(function() {
      return {
        start: mockStart,
        stop: mockStop,
        continuous: true,
        interimResults: true,
      };
    });
    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);

    render(<VoiceInputButton onTranscript={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /voice input/i });

    // Start listening
    fireEvent.click(btn);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Listening...")).toBeInTheDocument();

    // Stop listening
    fireEvent.click(btn);
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Listening...")).toBeNull();
  });

  it("stops listening automatically once a final transcript is received (Fix 5)", () => {
    let onresultCallback: (event: any) => void = () => {};
    const mockStart = vi.fn();
    const mockStop = vi.fn();

    const MockSpeechRecognition = vi.fn().mockImplementation(function () {
      return {
        start: mockStart,
        stop: mockStop,
        continuous: true,
        interimResults: true,
        set onresult(cb: any) {
          onresultCallback = cb;
        },
      };
    });
    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);

    render(<VoiceInputButton onTranscript={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /voice input/i });

    fireEvent.click(btn);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Listening...")).toBeInTheDocument();

    // Simulate a finalized transcript event from the browser.
    act(() => {
      onresultCallback({
        resultIndex: 0,
        results: [Object.assign([{ transcript: "book me a taxi" }], { isFinal: true })],
      });
    });

    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Listening...")).toBeNull();
  });

  it("handles permission denial errors, rendering an inline error alert banner", async () => {
    let errorHandlerCallback: (err: any) => void = () => {};

    const MockSpeechRecognition = vi.fn().mockImplementation(function() {
      return {
        start: () => {},
        stop: () => {},
        set onerror(cb: any) {
          errorHandlerCallback = cb;
        }
      };
    });
    vi.stubGlobal("SpeechRecognition", MockSpeechRecognition);

    render(<VoiceInputButton onTranscript={vi.fn()} />);
    const btn = screen.getByRole("button", { name: /voice input/i });

    // Click to start listening
    fireEvent.click(btn);

    // Simulate browser permission denied callback event
    act(() => {
      errorHandlerCallback({ error: "not-allowed" });
    });

    // Warning notification badge should display
    expect(
      screen.getByText("Microphone access needed — check your browser settings")
    ).toBeInTheDocument();

    // Clicking close dismisses the badge
    const closeBtn = screen.getByRole("button", { name: /close/i });
    fireEvent.click(closeBtn);
    expect(
      screen.queryByText("Microphone access needed — check your browser settings")
    ).toBeNull();
  });
});
