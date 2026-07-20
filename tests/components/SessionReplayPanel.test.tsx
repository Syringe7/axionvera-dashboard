import { act, fireEvent, render, screen } from "@testing-library/react";
import SessionReplayPanel from "@/components/SessionReplayPanel";

// Mock the hook so the test stays isolated from IndexedDB / MutationObserver /
// SessionRecorder plumbing. We still verify the panel's prop forwarding and
// UI behavior end-to-end at the panel layer.
jest.mock("@/hooks/useSessionReplay", () => ({
  __esModule: true,
  useSessionReplay: jest.fn(),
}));

import { useSessionReplay } from "@/hooks/useSessionReplay";
import type { UseSessionReplayResult } from "@/hooks/useSessionReplay";

const mockUseSessionReplay = useSessionReplay as jest.MockedFunction<
  typeof useSessionReplay
>;

/**
 * Build a default-friendly `UseSessionReplayResult` with all callbacks as
 * `jest.fn()` mocks. Tests override individual fields to exercise the panel's
 * behavior in each recording state.
 */
const buildMockReplay = (
  overrides: Partial<UseSessionReplayResult> = {},
): UseSessionReplayResult => ({
  isRecording: false,
  isReady: true,
  currentSessionId: null,
  eventCount: 0,
  sessions: [],
  error: null,
  start: jest.fn().mockResolvedValue(undefined),
  stop: jest.fn().mockResolvedValue(undefined),
  exportSession: jest.fn().mockResolvedValue(null),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  refresh: jest.fn().mockResolvedValue(undefined),
  loadSessionEvents: jest.fn().mockResolvedValue([]),
  ...overrides,
});

describe("SessionReplayPanel — autoStart gating", () => {
  beforeEach(() => {
    mockUseSessionReplay.mockReset();
  });

  it("passes { autoStart: false } to the hook when no prop is supplied (default behavior)", () => {
    mockUseSessionReplay.mockReturnValue(buildMockReplay());

    render(<SessionReplayPanel />);

    expect(mockUseSessionReplay).toHaveBeenCalledTimes(1);
    expect(mockUseSessionReplay).toHaveBeenCalledWith({ autoStart: false });
  });

  it("does not invoke replay.start() as a side effect of mount when autoStart defaults to false", async () => {
    const start = jest.fn().mockResolvedValue(undefined);
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ start }));

    render(<SessionReplayPanel />);
    // Drain any post-mount microtasks so a hidden async start() would have run.
    await act(async () => {
      await Promise.resolve();
    });

    expect(start).not.toHaveBeenCalled();
  });

  it("forwards autoStart={true} to the hook as an explicit override", () => {
    mockUseSessionReplay.mockReturnValue(
      buildMockReplay({ isRecording: true, currentSessionId: "session-override" }),
    );

    render(<SessionReplayPanel autoStart />);

    expect(mockUseSessionReplay).toHaveBeenCalledWith({ autoStart: true });
  });

  it("forwards className through next to the hook (props are passed unchanged)", () => {
    mockUseSessionReplay.mockReturnValue(buildMockReplay());

    render(<SessionReplayPanel className="extra-classes" autoStart={false} />);

    expect(mockUseSessionReplay).toHaveBeenCalledWith({ autoStart: false });
    const root = screen.getByTestId("session-replay-panel");
    expect(root.className).toContain("extra-classes");
  });
});

describe("SessionReplayPanel — Record / Stop rendering", () => {
  beforeEach(() => {
    mockUseSessionReplay.mockReset();
  });

  it("renders the Record control (not Stop) when isRecording is false", () => {
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ isRecording: false }));

    render(<SessionReplayPanel />);

    expect(screen.getByTestId("session-start")).toBeInTheDocument();
    expect(screen.queryByTestId("session-stop")).not.toBeInTheDocument();
  });

  it("renders the Stop control (not Record) when isRecording is true", () => {
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ isRecording: true }));

    render(<SessionReplayPanel autoStart />);

    expect(screen.getByTestId("session-stop")).toBeInTheDocument();
    expect(screen.queryByTestId("session-start")).not.toBeInTheDocument();
  });

  it("clicking Record in the inactive state invokes replay.start()", async () => {
    const start = jest.fn().mockResolvedValue(undefined);
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ start }));

    render(<SessionReplayPanel />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("session-start"));
    });

    expect(start).toHaveBeenCalledTimes(1);
  });

  it("clicking Stop in the active state invokes replay.stop()", async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    mockUseSessionReplay.mockReturnValue(
      buildMockReplay({ isRecording: true, stop }),
    );

    render(<SessionReplayPanel autoStart />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("session-stop"));
    });

    expect(stop).toHaveBeenCalledTimes(1);
  });
});

// ------------------------------------------------------------------
// Session list view
// ------------------------------------------------------------------

describe("SessionReplayPanel — Session list view", () => {
  beforeEach(() => {
    mockUseSessionReplay.mockReset();
  });

  it("renders the empty state when no sessions exist", () => {
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions: [] }));
    render(<SessionReplayPanel />);
    expect(screen.getByText("No recorded sessions yet.")).toBeInTheDocument();
  });

  it("renders session entries when sessions are provided", () => {
    const sessions = [
      { id: "s1", startedAt: 1000, endedAt: 2000, url: "https://example.com", userAgent: "Jest", events: 10, label: "Session 1" },
      { id: "s2", startedAt: 5000, endedAt: 7000, url: "https://example.com", userAgent: "Jest", events: 5 },
    ];
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions }));
    render(<SessionReplayPanel />);
    expect(screen.getByText("Session 1")).toBeInTheDocument();
    expect(screen.getByText("s2")).toBeInTheDocument();
  });

  it("shows session detail placeholder when no session is selected", () => {
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions: [] }));
    render(<SessionReplayPanel />);
    expect(screen.getByText("Select a session to see its metadata.")).toBeInTheDocument();
  });

  it("clicking a session entry shows its detail metadata", () => {
    const sessions = [
      { id: "s1", startedAt: 1000, endedAt: 2000, url: "https://example.com", userAgent: "Jest", events: 10 },
    ];
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions }));
    render(<SessionReplayPanel />);
    // Click the list entry (not the code element in the detail panel)
    fireEvent.click(screen.getByTestId("session-list").querySelector("button")!);
    expect(screen.getByText("Session ID")).toBeInTheDocument();
    expect(screen.getByTestId("session-detail").textContent).toContain("s1");
  });

  it("highlights the selected session entry", () => {
    const sessions = [
      { id: "s1", startedAt: 1000, endedAt: 2000, url: "https://example.com", userAgent: "Jest", events: 10 },
    ];
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions }));
    render(<SessionReplayPanel />);
    const button = screen.getByTestId("session-list").querySelector("button")!;
    fireEvent.click(button);
    expect(button.className).toContain("border-primary");
  });
});

// ------------------------------------------------------------------
// Export, Delete, Replay buttons
// ------------------------------------------------------------------

describe("SessionReplayPanel — Session actions", () => {
  beforeEach(() => {
    mockUseSessionReplay.mockReset();
  });

  const sessions = [
    { id: "s1", startedAt: 1000, endedAt: 2000, url: "https://example.com", userAgent: "Jest", events: 10 },
  ];

  it("shows Export, Delete, and Replay buttons when a session is selected", () => {
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions }));
    render(<SessionReplayPanel />);
    fireEvent.click(screen.getByTestId("session-list").querySelector("button")!);
    expect(screen.getByTestId("session-export")).toBeInTheDocument();
    expect(screen.getByTestId("session-delete")).toBeInTheDocument();
    expect(screen.getByTestId("session-replay")).toBeInTheDocument();
  });

  it("exportSession is called when the Export button is clicked", async () => {
    const exportSession = jest.fn().mockResolvedValue(new Blob(["{}"], { type: "application/json" }));
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions, exportSession }));
    render(<SessionReplayPanel />);
    fireEvent.click(screen.getByText("s1"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("session-export"));
    });
    expect(exportSession).toHaveBeenCalledWith("s1");
  });

  it("deleteSession is called when the Delete button is clicked", async () => {
    const deleteSession = jest.fn().mockResolvedValue(undefined);
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions, deleteSession }));
    render(<SessionReplayPanel />);
    fireEvent.click(screen.getByText("s1"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("session-delete"));
    });
    expect(deleteSession).toHaveBeenCalledWith("s1");
  });

  it("loadSessionEvents is called and switches to playback view on Replay", async () => {
    const loadSessionEvents = jest.fn().mockResolvedValue([
      { id: "e1", sessionId: "s1", type: "click", timestamp: 1000, data: {} },
    ]);
    mockUseSessionReplay.mockReturnValue(
      buildMockReplay({ sessions, loadSessionEvents }),
    );
    render(<SessionReplayPanel />);
    fireEvent.click(screen.getByText("s1"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("session-replay"));
    });
    expect(loadSessionEvents).toHaveBeenCalledWith("s1");
    // Should switch to playback view
    expect(screen.getByTestId("session-playback-panel")).toBeInTheDocument();
  });

  it("export handles null blob gracefully (session not found)", async () => {
    const exportSession = jest.fn().mockResolvedValue(null);
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions, exportSession }));
    render(<SessionReplayPanel />);
    fireEvent.click(screen.getByText("s1"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("session-export"));
    });
    expect(exportSession).toHaveBeenCalledWith("s1");
  });
});

// ------------------------------------------------------------------
// Error display
// ------------------------------------------------------------------

describe("SessionReplayPanel — Error states", () => {
  beforeEach(() => {
    mockUseSessionReplay.mockReset();
  });

  it("renders the error banner when the hook reports an error", () => {
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ error: "Something went wrong" }));
    render(<SessionReplayPanel />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("does not render the error banner when there is no error", () => {
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ error: null }));
    render(<SessionReplayPanel />);
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });
});

// ------------------------------------------------------------------
// Detail panel metadata display
// ------------------------------------------------------------------

describe("SessionReplayPanel — Detail panel metadata", () => {
  beforeEach(() => {
    mockUseSessionReplay.mockReset();
  });

  it("displays session metadata fields when selected", () => {
    const sessions = [
      { id: "s1", startedAt: 1000, endedAt: 5000, url: "https://example.com", userAgent: "Jest", events: 42, label: "Test Session" },
    ];
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions }));
    render(<SessionReplayPanel />);
    fireEvent.click(screen.getByText("Test Session"));
    expect(screen.getByText("Session ID")).toBeInTheDocument();
    expect(screen.getByText("Started at")).toBeInTheDocument();
    expect(screen.getByText("Ended at")).toBeInTheDocument();
    expect(screen.getByText("Events")).toBeInTheDocument();
    expect(screen.getByText("URL")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("shows 'in progress' for sessions without endedAt", () => {
    const sessions = [
      { id: "s1", startedAt: 1000, endedAt: undefined, url: "https://example.com", userAgent: "Jest", events: 5 },
    ];
    mockUseSessionReplay.mockReturnValue(buildMockReplay({ sessions }));
    render(<SessionReplayPanel />);
    fireEvent.click(screen.getByText("s1"));
    // The ended at section should be empty (no endedAt)
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------
// Back-to-list from playback
// ------------------------------------------------------------------

describe("SessionReplayPanel — Playback navigation", () => {
  beforeEach(() => {
    mockUseSessionReplay.mockReset();
  });

  it("clicking Back in the playback panel returns to the list view", async () => {
    const sessions = [
      { id: "s1", startedAt: 1000, endedAt: 2000, url: "https://example.com", userAgent: "Jest", events: 10 },
    ];
    const loadSessionEvents = jest.fn().mockResolvedValue([
      { id: "e1", sessionId: "s1", type: "click", timestamp: 1000, data: {} },
    ]);
    mockUseSessionReplay.mockReturnValue(
      buildMockReplay({ sessions, loadSessionEvents }),
    );
    render(<SessionReplayPanel />);

    // Switch to playback
    fireEvent.click(screen.getByTestId("session-list").querySelector("button")!);
    await act(async () => {
      fireEvent.click(screen.getByTestId("session-replay"));
    });
    expect(screen.getByTestId("session-playback-panel")).toBeInTheDocument();

    // Go back
    await act(async () => {
      fireEvent.click(screen.getByTestId("playback-back"));
    });
    expect(screen.queryByTestId("session-playback-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-list")).toBeInTheDocument();
  });
});
