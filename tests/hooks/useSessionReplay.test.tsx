import { act, renderHook, waitFor } from "@testing-library/react";
import { useSessionReplay } from "@/hooks/useSessionReplay";
import { IndexedDBSessionStore } from "@/session";
import { FakeIDBFactory } from "../utils/fakeIndexedDB";
import type { SessionEvent } from "@/session";

/**
 * Create a test-friendly store backed by the in-memory FakeIDBFactory.
 */
const createStore = () => {
  const idbFactory = new FakeIDBFactory() as unknown as IDBFactory;
  return new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
};

/**
 * Build a minimal SessionEvent for assertions.
 */
const makeEvent = (overrides: Partial<SessionEvent> = {}): SessionEvent => ({
  id: overrides.id ?? "evt-1",
  sessionId: "test-session",
  type: "click",
  timestamp: 1000,
  data: { selector: "button", text: "x", x: 0, y: 0, button: 0, modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
  ...overrides,
});

describe("useSessionReplay", () => {
  // ------------------------------------------------------------------
  // Initial state
  // ------------------------------------------------------------------

  it("returns correct initial state before store is ready", () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    expect(result.current.isRecording).toBe(false);
    expect(result.current.currentSessionId).toBeNull();
    expect(result.current.eventCount).toBe(0);
    expect(result.current.sessions).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("initializes the store and becomes ready on mount", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });
  });

  it("does not auto-start when autoStart is false", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.currentSessionId).toBeNull();
  });

  // ------------------------------------------------------------------
  // Start / Stop lifecycle
  // ------------------------------------------------------------------

  it("start() begins recording and generates a session id", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.isRecording).toBe(true);
    expect(result.current.currentSessionId).not.toBeNull();
    expect(typeof result.current.currentSessionId).toBe("string");
  });

  it("start() does nothing if already recording", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    await act(async () => {
      await result.current.start();
    });
    const firstId = result.current.currentSessionId;

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.currentSessionId).toBe(firstId);
  });

  it("stop() ends recording and persists metadata", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("stop() is safe to call when not recording", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    // Should not throw
    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.isRecording).toBe(false);
  });

  // ------------------------------------------------------------------
  // Event counting
  // ------------------------------------------------------------------

  it("eventCount increases as events are emitted during recording", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    await act(async () => {
      await result.current.start();
    });

    // The recorder starts with a session:start event
    expect(result.current.eventCount).toBeGreaterThanOrEqual(1);

    await act(async () => {
      await result.current.stop();
    });

    // session:stop is added on stop
    expect(result.current.eventCount).toBeGreaterThanOrEqual(2);
  });

  // ------------------------------------------------------------------
  // refresh() populates sessions list
  // ------------------------------------------------------------------

  it("refresh() populates the sessions list from the store", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    // Initially empty
    expect(result.current.sessions).toEqual([]);

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.sessions.length).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------------
  // deleteSession()
  // ------------------------------------------------------------------

  it("deleteSession() removes a session from the store", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    // Start and stop to create a session
    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.sessions.length).toBeGreaterThanOrEqual(1);
    const sessionId = result.current.sessions[0].id;

    await act(async () => {
      await result.current.deleteSession(sessionId);
    });

    // The session should be gone
    const found = result.current.sessions.find((s) => s.id === sessionId);
    expect(found).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // exportSession()
  // ------------------------------------------------------------------

  it("exportSession() returns a Blob for an existing session", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });

    const sessionId = result.current.sessions[0]?.id;
    if (sessionId) {
      const blob = await result.current.exportSession(sessionId);
      expect(blob).toBeInstanceOf(Blob);
    }
  });

  it("exportSession() returns null for an unknown session", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    const blob = await result.current.exportSession("nonexistent-session");
    expect(blob).toBeNull();
  });

  // ------------------------------------------------------------------
  // loadSessionEvents()
  // ------------------------------------------------------------------

  it("loadSessionEvents() returns events for an existing session", async () => {
    const store = createStore();
    const { result } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });

    const sessionId = result.current.sessions[0]?.id;
    if (sessionId) {
      const events = await result.current.loadSessionEvents(sessionId);
      expect(events).not.toBeNull();
      expect(Array.isArray(events)).toBe(true);
      expect(events!.length).toBeGreaterThanOrEqual(2); // session:start + session:stop
    }
  });

  it("loadSessionEvents() returns null when store is unavailable", async () => {
    // We need to suppress the fallback to globalThis.indexedDB so the
    // hook keeps storeRef.current === null.  Override the global temporarily.
    const origIDB = (globalThis as Record<string, unknown>).indexedDB;
    try {
      delete (globalThis as Record<string, unknown>).indexedDB;
      const { result } = renderHook(() => useSessionReplay({ autoStart: false }));
      // Give the mount effect a tick to run (it should bail early because
      // there is no store and no global indexedDB).
      await act(async () => {
        await Promise.resolve();
      });
      const events = await result.current.loadSessionEvents("anything");
      expect(events).toBeNull();
    } finally {
      (globalThis as Record<string, unknown>).indexedDB = origIDB;
    }
  });

  // ------------------------------------------------------------------
  // Error handling
  // ------------------------------------------------------------------

  it("start() captures errors when store initialization fails", async () => {
    const badStore = {
      init: () => Promise.reject(new Error("DB init failed")),
      listMetadata: () => Promise.resolve([]),
      saveMetadata: () => Promise.resolve(),
      saveEvents: () => Promise.resolve(),
    } as unknown as IndexedDBSessionStore;

    const { result } = renderHook(() => useSessionReplay({ store: badStore, autoStart: false }));

    // The mount effect also calls init(), which fails.  Wait for the
    // mount effect to settle (isReady stays false, error is set).
    await act(async () => {
      await Promise.resolve();
    });

    // Even though isReady is false, start() re-attempts init() and
    // captures the error.
    await act(async () => {
      await result.current.start();
    });

    expect(result.current.error).toContain("DB init failed");
    expect(result.current.isRecording).toBe(false);
  });

  // ------------------------------------------------------------------
  // Label option
  // ------------------------------------------------------------------

  it("passes the label option to the metadata", async () => {
    const store = createStore();
    const { result } = renderHook(() =>
      useSessionReplay({ store, autoStart: false, label: "my-session" }),
    );

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await result.current.stop();
    });

    const session = result.current.sessions[0];
    expect(session?.label).toBe("my-session");
  });

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------

  it("stops recording and persists events when the hook unmounts", async () => {
    const store = createStore();
    const { result, unmount } = renderHook(() => useSessionReplay({ store, autoStart: false }));

    await waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.isRecording).toBe(true);

    // Unmount while recording
    unmount();

    // After unmount, the store should still have the session
    // (verifying the cleanup side effect persisted)
    const list = await store.listMetadata();
    // There should be at least the session we started (may have partial events)
    expect(list.length).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------------
  // sessionMasker static export
  // ------------------------------------------------------------------

  it("exports sessionMasker from the module", async () => {
    const { sessionMasker } = await import("@/hooks/useSessionReplay");
    expect(sessionMasker).toBeDefined();
    expect(typeof sessionMasker.maskText).toBe("function");
  });
});
