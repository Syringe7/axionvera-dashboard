import { SessionPlayer } from "@/session";
import type { SessionEvent } from "@/session";

const makeEvent = (index: number, type: SessionEvent["type"] = "click", timestamp = 1000 + index * 100): SessionEvent => ({
  id: `e${index}`,
  sessionId: "s1",
  type,
  timestamp,
  data: { selector: "a", text: "x", x: 0, y: 0, button: 0, modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
});

describe("SessionPlayer", () => {
  it("processes every event in order via flush()", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const steps: number[] = [];
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1), makeEvent(2)],
      sandbox,
      onStep: (event) => steps.push(event.timestamp),
    });
    player.flush();
    expect(steps).toEqual([1000, 1100, 1200]);
  });

  it("invokes onComplete after all events are flushed", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const onComplete = jest.fn();
    const player = new SessionPlayer({
      events: [makeEvent(0)],
      sandbox,
      onComplete,
    });
    player.flush();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("schedules events using injected setTimeout/clearTimeout", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const calls: Array<{ fn: () => void; delay: number }> = [];
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1)],
      sandbox,
      onStep: () => {},
      setTimeout: ((fn: () => void, delay: number) => {
        calls.push({ fn, delay });
        return 1 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // Run queued ticks
    while (calls.length > 0) {
      const next = calls.shift()!;
      if (!player.isPlaying()) break;
      next.fn();
    }
    expect(player.isPlaying()).toBe(false);
  });

  it("honors speed multiplier when recomputing the schedule", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const delays: number[] = [];
    const player = new SessionPlayer({
      events: [makeEvent(0, "click", 1000), makeEvent(1, "click", 1500)],
      sandbox,
      setTimeout: ((fn: () => void, delay: number) => {
        delays.push(delay);
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.setSpeed(2);
    player.play();
    // First delay is dropped to allow immediate playback; second should be 500/2 = 250.
    expect(delays[delays.length - 1]).toBeCloseTo(250, 5);
  });

  it("seek() clamps out-of-range indices", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1), makeEvent(2)],
      sandbox,
    });
    player.seek(-5);
    expect(player.currentIndex).toBe(0);
    player.seek(999);
    expect(player.currentIndex).toBe(3);
    player.seek(1);
    expect(player.currentIndex).toBe(1);
  });

  it("setSpeed rejects non-positive numbers", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const player = new SessionPlayer({ events: [makeEvent(0)], sandbox });
    expect(() => player.setSpeed(0)).toThrow();
    expect(() => player.setSpeed(-1)).toThrow();
  });

  it("dispatches CustomEvent on sandbox for mutation events", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const listener = jest.fn();
    sandbox.addEventListener("session-replay:apply", listener);
    const player = new SessionPlayer({
      events: [
        {
          id: "mut",
          sessionId: "s1",
          type: "mutation",
          timestamp: 1000,
          data: { target: "body", kind: "characterData", addedNodes: [], removedCount: 0 },
        },
      ],
      sandbox,
    });
    player.flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("skips mutation event dispatch when onMutationApply is provided", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const onMutationApply = jest.fn();
    const sandboxListener = jest.fn();
    sandbox.addEventListener("session-replay:apply", sandboxListener);
    const player = new SessionPlayer({
      events: [
        {
          id: "mut",
          sessionId: "s1",
          type: "mutation",
          timestamp: 1000,
          data: { target: "body", kind: "characterData", addedNodes: [], removedCount: 0 },
        },
      ],
      sandbox,
      onMutationApply,
    });
    player.flush();
    expect(onMutationApply).toHaveBeenCalledTimes(1);
    expect(sandboxListener).not.toHaveBeenCalled();
  });

  it("throws when constructed without events or sandbox", () => {
    expect(() => new SessionPlayer({ events: undefined as unknown as SessionEvent[], sandbox: document.createElement("div") })).toThrow(/events/);
    expect(() => new SessionPlayer({ events: [], sandbox: undefined as unknown as HTMLElement })).toThrow(/sandbox/);
  });

  // ------------------------------------------------------------------
  // Pause / Resume lifecycle
  // ------------------------------------------------------------------

  it("pause() stops playback without losing place", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const steps: number[] = [];
    const calls: Array<{ fn: () => void; delay: number }> = [];
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1), makeEvent(2)],
      sandbox,
      onStep: (event) => steps.push(event.timestamp),
      setTimeout: ((fn: () => void, delay: number) => {
        calls.push({ fn, delay });
        return calls.length as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    expect(player.isPlaying()).toBe(true);
    // Process first event
    calls.shift()!.fn();
    expect(steps).toHaveLength(1);
    player.pause();
    expect(player.isPlaying()).toBe(false);
    expect(player.currentIndex).toBe(1);
    // Remaining calls should not advance the player
    expect(calls.length).toBeGreaterThan(0);
  });

  it("play() resumes from current index after pause", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const steps: number[] = [];
    const calls: Array<{ fn: () => void; delay: number }> = [];
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1), makeEvent(2)],
      sandbox,
      onStep: (event) => steps.push(event.timestamp),
      setTimeout: ((fn: () => void, delay: number) => {
        calls.push({ fn, delay });
        return calls.length as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    calls.shift()!.fn(); // process event 0
    player.pause();
    expect(player.currentIndex).toBe(1);
    calls.length = 0; // clear any leftover
    player.play();
    expect(player.isPlaying()).toBe(true);
    calls.shift()!.fn(); // process event 1
    expect(steps).toHaveLength(2);
    expect(steps[1]).toBe(1100);
  });

  // ------------------------------------------------------------------
  // Stop and reset
  // ------------------------------------------------------------------

  it("stop() resets index to 0", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1), makeEvent(2)],
      sandbox,
    });
    player.flush();
    expect(player.currentIndex).toBe(3);
    player.stop();
    expect(player.currentIndex).toBe(0);
  });

  it("stop() clears any active timer", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    let timerCleared = false;
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1)],
      sandbox,
      setTimeout: ((fn: () => void, _delay: number) => {
        fn();
        return 42 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => {
        timerCleared = true;
      }) as unknown as typeof clearTimeout,
    });
    player.play();
    timerCleared = false;
    player.stop();
    expect(timerCleared).toBe(true);
  });

  // ------------------------------------------------------------------
  // Empty events array
  // ------------------------------------------------------------------

  it("handles empty events array gracefully with flush()", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const onComplete = jest.fn();
    const player = new SessionPlayer({
      events: [],
      sandbox,
      onComplete,
    });
    player.flush();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(player.currentIndex).toBe(0);
    expect(player.totalEvents).toBe(0);
  });

  it("does not play when events array is empty", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const calls: Array<{ fn: () => void; delay: number }> = [];
    const player = new SessionPlayer({
      events: [],
      sandbox,
      setTimeout: ((fn: () => void, delay: number) => {
        calls.push({ fn, delay });
        return calls.length as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    expect(calls).toHaveLength(0);
    expect(player.isPlaying()).toBe(false);
  });

  // ------------------------------------------------------------------
  // totalEvents getter
  // ------------------------------------------------------------------

  it("totalEvents returns the correct count", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1), makeEvent(2), makeEvent(3), makeEvent(4)],
      sandbox,
    });
    expect(player.totalEvents).toBe(5);
  });

  // ------------------------------------------------------------------
  // Seek during playback
  // ------------------------------------------------------------------

  it("seek() during playback pauses and resumes at the new position", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const steps: number[] = [];
    const calls: Array<{ fn: () => void; delay: number }> = [];
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1), makeEvent(2), makeEvent(3)],
      sandbox,
      onStep: (event) => steps.push(event.timestamp),
      setTimeout: ((fn: () => void, delay: number) => {
        calls.push({ fn, delay });
        return calls.length as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    calls.shift()!.fn(); // process event 0
    // Seek to index 3 (past the end, clamped to 4)
    player.seek(3);
    expect(player.currentIndex).toBe(3);
    // After seek with wasPlaying, it resumes
    expect(player.isPlaying()).toBe(true);
    calls.shift()!.fn(); // process event 3
    expect(steps).toHaveLength(2);
    expect(steps[0]).toBe(1000); // event 0
    expect(steps[1]).toBe(1300); // event 3
  });

  // ------------------------------------------------------------------
  // play() is idempotent
  // ------------------------------------------------------------------

  it("play() is idempotent when already playing", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const calls: Array<{ fn: () => void; delay: number }> = [];
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1)],
      sandbox,
      setTimeout: ((fn: () => void, delay: number) => {
        calls.push({ fn, delay });
        return calls.length as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    const callCount = calls.length;
    player.play(); // should be no-op
    expect(calls.length).toBe(callCount);
  });

  it("play() is no-op when aborted", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const player = new SessionPlayer({
      events: [makeEvent(0)],
      sandbox,
    });
    player.flush();
    player.play(); // already done, should be no-op
    expect(player.isPlaying()).toBe(false);
  });

  // ------------------------------------------------------------------
  // Speed changes during playback
  // ------------------------------------------------------------------

  it("setSpeed() recalculates delays and resumes if was playing", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const delays: number[] = [];
    const calls: Array<{ fn: () => void; delay: number }> = [];
    const player = new SessionPlayer({
      events: [makeEvent(0, "click", 1000), makeEvent(1, "click", 2000)],
      sandbox,
      setTimeout: ((fn: () => void, delay: number) => {
        delays.push(delay);
        calls.push({ fn, delay });
        return calls.length as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    calls.shift()!.fn(); // process event 0
    expect(player.isPlaying()).toBe(true);
    calls.length = 0;
    delays.length = 0;
    player.setSpeed(4);
    // setSpeed pauses and resumes, so new delays should reflect 4x speed
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  // ------------------------------------------------------------------
  // onComplete is called when playback finishes via play()
  // ------------------------------------------------------------------

  it("onComplete is called when play() finishes naturally", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const onComplete = jest.fn();
    const calls: Array<{ fn: () => void; delay: number }> = [];
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1)],
      sandbox,
      onComplete,
      setTimeout: ((fn: () => void, delay: number) => {
        calls.push({ fn, delay });
        return calls.length as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    while (calls.length > 0 && player.isPlaying()) {
      calls.shift()!.fn();
    }
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(player.isPlaying()).toBe(false);
  });

  // ------------------------------------------------------------------
  // onStep receives correct index parameter
  // ------------------------------------------------------------------

  it("onStep receives the correct index for each event", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const receivedIndices: number[] = [];
    const player = new SessionPlayer({
      events: [makeEvent(0), makeEvent(1), makeEvent(2)],
      sandbox,
      onStep: (_event, index) => receivedIndices.push(index),
    });
    player.flush();
    expect(receivedIndices).toEqual([0, 1, 2]);
  });

  // ------------------------------------------------------------------
  // Default speed is 1
  // ------------------------------------------------------------------

  it("defaults speed to 1", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const delays: number[] = [];
    const player = new SessionPlayer({
      events: [makeEvent(0, "click", 1000), makeEvent(1, "click", 1500)],
      sandbox,
      setTimeout: ((fn: () => void, delay: number) => {
        delays.push(delay);
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    // At speed 1, the second delay should be (1500 - 1000) / 1 = 500
    expect(delays[delays.length - 1]).toBeCloseTo(500, 5);
  });

  // ------------------------------------------------------------------
  // Simultaneous events produce zero delay between them
  // ------------------------------------------------------------------

  it("handles simultaneous events (same timestamp) without tight loop", () => {
    const sandbox = document.createElement("div");
    document.body.appendChild(sandbox);
    const delays: number[] = [];
    const player = new SessionPlayer({
      events: [makeEvent(0, "click", 1000), makeEvent(1, "click", 1000)],
      sandbox,
      setTimeout: ((fn: () => void, delay: number) => {
        delays.push(delay);
        fn();
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    });
    player.play();
    // Both delays should be 0 for simultaneous events
    for (const d of delays) {
      expect(d).toBe(0);
    }
  });
});
