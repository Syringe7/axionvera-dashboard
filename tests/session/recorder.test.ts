import { Masker, SessionRecorder } from "@/session";
import type { RecorderOptions, SessionEvent, NavigationEventData, ConsoleEventData, ClickEventData, InputEventData } from "@/session";

/**
 * Hand-rolled MutationObserver mock. We pass the *class* to the recorder's
 * platform so it can construct observers normally, then pull them out via the
 * `created` stack to drive the mutation pipeline deterministically.
 */
class FakeMutationObserver implements MutationObserver {
  public readonly callback: MutationCallback;
  public observedTargets: Array<{ target: Node; init: MutationObserverInit }> = [];
  public disconnected = false;
  static readonly created: FakeMutationObserver[] = [];

  constructor(callback: MutationCallback) {
    this.callback = callback;
    FakeMutationObserver.created.push(this);
  }

  observe(target: Node, init: MutationObserverInit): void {
    this.observedTargets.push({ target, init });
  }
  disconnect(): void {
    this.disconnected = true;
  }
  takeRecords(): MutationRecord[] {
    return [];
  }
  trigger(records: MutationRecord[]): void {
    this.callback(records, this);
  }
}

const buildPlatform = (overrides: Partial<{ MutationObserver: typeof MutationObserver }> = {}) => {
  const window = globalThis.window!;
  const document = window.document;
  return {
    window,
    document,
    MutationObserver: (overrides.MutationObserver ?? FakeMutationObserver) as typeof MutationObserver,
  } as Required<RecorderOptions["platform"]>;
};

const createRecorder = (overrides: Partial<RecorderOptions> = {}) => {
  const events: SessionEvent[] = [];
  FakeMutationObserver.created.length = 0;
  const platform = buildPlatform();
  const recorder = new SessionRecorder({
    sessionId: "session-x",
    emit: (event) => events.push(event),
    ...overrides,
    platform,
  });
  return { recorder, events, platform };
};

const makeMutationRecord = (target: Node, additions: Node[] = []): MutationRecord => ({
  type: "childList",
  target,
  addedNodes: additions as unknown as NodeList,
  removedNodes: [] as unknown as NodeList,
  previousSibling: null,
  nextSibling: null,
  attributeName: null,
  attributeNamespace: null,
  oldValue: null,
});

describe("SessionRecorder", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    FakeMutationObserver.created.length = 0;
  });

  it("throws when constructed without sessionId or emit", () => {
    expect(() => new SessionRecorder({ sessionId: "", emit: () => {} } as RecorderOptions)).toThrow(/sessionId/);
    expect(() => new SessionRecorder({ sessionId: "abc", emit: undefined as unknown as (event: SessionEvent) => void })).toThrow(/emit/);
  });

  it("emits a session:start and session:stop pair around its lifetime", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    recorder.start(); // idempotent
    recorder.stop();
    recorder.stop(); // idempotent
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("session:start");
    expect(types[types.length - 1]).toBe("session:stop");
  });

  it("captures click events with selector and masked text", () => {
    const { recorder, events } = createRecorder();
    const button = document.createElement("button");
    button.textContent = "Submit";
    document.body.appendChild(button);
    recorder.start();
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0, clientX: 10, clientY: 20 }));
    recorder.stop();
    const clicks = events.filter((e) => e.type === "click");
    expect(clicks).toHaveLength(1);
    expect(clicks[0].data).toMatchObject({
      selector: "button",
      text: "Submit",
      x: 10,
      y: 20,
      button: 0,
      modifiers: { alt: false, ctrl: false, meta: false, shift: false },
    });
  });

  it("masks click targets that match a block selector", () => {
    const { recorder, events } = createRecorder({
      mask: { blockSelectors: [".secret"] },
    });
    const secretBtn = document.createElement("button");
    secretBtn.classList.add("secret");
    secretBtn.textContent = "secret action";
    document.body.appendChild(secretBtn);
    recorder.start();
    secretBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    recorder.stop();
    const click = events.find((e) => e.type === "click");
    expect(click).toBeDefined();
    expect(click!.data).toMatchObject({ text: "•••••• ••••••" });
  });

  it("captures input events with masked password values", () => {
    const { recorder, events } = createRecorder();
    const input = document.createElement("input");
    input.type = "password";
    input.name = "pwd";
    document.body.appendChild(input);
    recorder.start();
    input.value = "hunter2";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    recorder.stop();
    const inputs = events.filter((e) => e.type === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].data).toMatchObject({ value: "•••••••", source: "input", name: "pwd" });
  });

  it("maskes email inputs even when not explicitly blocked", () => {
    const { recorder, events } = createRecorder();
    const input = document.createElement("input");
    input.type = "email";
    input.name = "email";
    document.body.appendChild(input);
    recorder.start();
    input.value = "user@example.com";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    recorder.stop();
    const captured = events.find((e) => e.type === "input");
    expect(captured).toBeDefined();
    expect(captured!.data).toMatchObject({ value: "••••••••••••••••" });
  });

  it("captures change events for select elements with empty value", () => {
    const { recorder, events } = createRecorder();
    const select = document.createElement("select");
    select.name = "country";
    select.innerHTML = "<option value='us'>US</option><option value='de'>DE</option>";
    document.body.appendChild(select);
    recorder.start();
    select.value = "de";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    recorder.stop();
    const changes = events.filter((e) => e.type === "input");
    expect(changes).toHaveLength(1);
    expect(changes[0].data).toMatchObject({ value: "", type: "select", source: "change" });
  });

  it("patches history.pushState and emits navigation events", () => {
    const { recorder, events } = createRecorder();
    const original = window.history.pushState.bind(window.history);
    recorder.start();
    try {
      window.history.pushState({}, "", "/page-b");
    } finally {
      window.history.pushState = original;
    }
    recorder.stop();
    const nav = events.find((e) => e.type === "navigation");
    expect(nav).toBeDefined();
    expect(nav!.data).toMatchObject({ method: "pushState" });
  });

  it("buffers mutation events flushed on stop()", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    expect(FakeMutationObserver.created).toHaveLength(1);
    const observer = FakeMutationObserver.created[0];
    const target = document.createElement("div");
    observer.trigger([makeMutationRecord(target, [target])]);
    recorder.stop();
    const mutations = events.filter((e) => e.type === "mutation");
    expect(mutations.length).toBeGreaterThanOrEqual(1);
    expect(observer.disconnected).toBe(true);
  });

  it("respects maxEvents and triggers onLimitReached", () => {
    const onLimit = jest.fn();
    const { recorder } = createRecorder({ maxEvents: 2, onLimitReached: onLimit });
    recorder.start();
    expect(recorder.eventCount()).toBe(1); // session:start
    const div = document.createElement("div");
    document.body.appendChild(div);
    div.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    div.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    div.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onLimit).toHaveBeenCalled();
    expect(recorder.eventCount()).toBeLessThanOrEqual(2);
    recorder.stop();
  });

  it("emits session:start and session:stop with the configured sessionId", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    recorder.stop();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.sessionId === "session-x")).toBe(true);
  });

  it("swallows sink errors without crashing", () => {
    const recorder = new SessionRecorder({
      sessionId: "swallow",
      emit: () => {
        throw new Error("sink boom");
      },
      platform: buildPlatform(),
    });
    const debugSpy = jest.spyOn(console, "debug").mockImplementation(() => undefined);
    try {
      expect(() => recorder.start()).not.toThrow();
      expect(() => recorder.stop()).not.toThrow();
      expect(debugSpy).toHaveBeenCalled();
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("supports multiple start/stop cycles", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    recorder.stop();
    recorder.start();
    recorder.stop();
    const starts = events.filter((e) => e.type === "session:start").length;
    const stops = events.filter((e) => e.type === "session:stop").length;
    expect(starts).toBe(2);
    expect(stops).toBe(2);
  });

  it("keeps Masker.guards working on detached elements", () => {
    const masker = new Masker({ blockSelectors: ["##bogus", ".ghost"] });
    const detached = document.createElement("span");
    expect(masker.shouldMaskElement(detached)).toBe(false);
    expect(() => masker.shouldMaskElement(null)).not.toThrow();
  });

  // ------------------------------------------------------------------
  // Navigation event coverage
  // ------------------------------------------------------------------

  it("captures popstate navigation events", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    window.dispatchEvent(new Event("popstate"));
    recorder.stop();
    const navs = events.filter((e) => e.type === "navigation");
    expect(navs).toHaveLength(1);
    expect(navs[0].data).toMatchObject({ method: "popstate" });
  });

  it("captures hashchange navigation events", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    window.dispatchEvent(new Event("hashchange"));
    recorder.stop();
    const navs = events.filter((e) => e.type === "navigation");
    expect(navs).toHaveLength(1);
    expect(navs[0].data).toMatchObject({ method: "popstate" });
  });

  it("patches history.replaceState and emits navigation events", () => {
    const { recorder, events } = createRecorder();
    const original = window.history.replaceState.bind(window.history);
    recorder.start();
    try {
      window.history.replaceState({}, "", "/page-c");
    } finally {
      window.history.replaceState = original;
    }
    recorder.stop();
    const nav = events.find((e) => e.type === "navigation" && (e.data as NavigationEventData).method === "replaceState");
    expect(nav).toBeDefined();
  });

  it("navigation event includes the document title", () => {
    const originalTitle = document.title;
    document.title = "Test Page";
    const { recorder, events } = createRecorder();
    recorder.start();
    window.dispatchEvent(new Event("popstate"));
    recorder.stop();
    document.title = originalTitle;
    const nav = events.find((e) => e.type === "navigation");
    expect(nav).toBeDefined();
    expect((nav!.data as NavigationEventData).title).toBe("Test Page");
  });

  it("navigation event includes the current URL", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    window.dispatchEvent(new Event("popstate"));
    recorder.stop();
    const nav = events.find((e) => e.type === "navigation");
    expect(nav).toBeDefined();
    const navData = nav!.data as NavigationEventData;
    expect(typeof navData.url).toBe("string");
    expect(navData.url.length).toBeGreaterThan(0);
  });

  // ------------------------------------------------------------------
  // Console capture coverage
  // ------------------------------------------------------------------

  it("captures console.log calls as console events", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    console.log("hello world");
    recorder.stop();
    const consoleEvents = events.filter((e) => e.type === "console");
    expect(consoleEvents).toHaveLength(1);
    expect(consoleEvents[0].data).toMatchObject({ level: "log", args: ["hello world"] });
  });

  it("captures console.warn calls", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    console.warn("warning message");
    recorder.stop();
    const consoleEvents = events.filter((e) => e.type === "console");
    expect(consoleEvents).toHaveLength(1);
    expect(consoleEvents[0].data).toMatchObject({ level: "warn", args: ["warning message"] });
  });

  it("captures console.error calls", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    console.error("error message");
    recorder.stop();
    const consoleEvents = events.filter((e) => e.type === "console");
    expect(consoleEvents).toHaveLength(1);
    expect(consoleEvents[0].data).toMatchObject({ level: "error", args: ["error message"] });
  });

  it("captures console.info calls", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    console.info("info message");
    recorder.stop();
    const consoleEvents = events.filter((e) => e.type === "console");
    expect(consoleEvents).toHaveLength(1);
    expect(consoleEvents[0].data).toMatchObject({ level: "info", args: ["info message"] });
  });

  it("truncates long console string args to 240 chars", () => {
    const { recorder, events } = createRecorder();
    const long = "x".repeat(300);
    recorder.start();
    console.log(long);
    recorder.stop();
    const consoleEvents = events.filter((e) => e.type === "console");
    const consoleData = consoleEvents[0].data as ConsoleEventData;
    expect(consoleData.args[0]).toHaveLength(240);
  });

  it("serializes Error objects in console args", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    console.error(new Error("test error"));
    recorder.stop();
    const consoleEvents = events.filter((e) => e.type === "console");
    const consoleData = consoleEvents[0].data as ConsoleEventData;
    expect(consoleData.args[0]).toContain("test error");
  });

  it("serializes objects in console args as JSON strings", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    console.log({ foo: "bar", num: 42 });
    recorder.stop();
    const consoleEvents = events.filter((e) => e.type === "console");
    const consoleData = consoleEvents[0].data as ConsoleEventData;
    expect(consoleData.args[0]).toContain("foo");
  });

  it("limits console args to 8 entries", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    console.log(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    recorder.stop();
    const consoleEvents = events.filter((e) => e.type === "console");
    const consoleData = consoleEvents[0].data as ConsoleEventData;
    expect(consoleData.args).toHaveLength(8);
  });

  // ------------------------------------------------------------------
  // Modifier keys on click events
  // ------------------------------------------------------------------

  it("captures alt key modifier on click", () => {
    const { recorder, events } = createRecorder();
    const btn = document.createElement("button");
    btn.textContent = "Click";
    document.body.appendChild(btn);
    recorder.start();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true }));
    recorder.stop();
    const click = events.find((e) => e.type === "click");
    expect(click!.data).toMatchObject({ modifiers: { alt: true, ctrl: false, meta: false, shift: false } });
  });

  it("captures ctrl key modifier on click", () => {
    const { recorder, events } = createRecorder();
    const btn = document.createElement("button");
    btn.textContent = "Click";
    document.body.appendChild(btn);
    recorder.start();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    recorder.stop();
    const click = events.find((e) => e.type === "click");
    expect(click!.data).toMatchObject({ modifiers: { alt: false, ctrl: true, meta: false, shift: false } });
  });

  it("captures shift key modifier on click", () => {
    const { recorder, events } = createRecorder();
    const btn = document.createElement("button");
    btn.textContent = "Click";
    document.body.appendChild(btn);
    recorder.start();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    recorder.stop();
    const click = events.find((e) => e.type === "click");
    expect(click!.data).toMatchObject({ modifiers: { alt: false, ctrl: false, meta: false, shift: true } });
  });

  it("captures meta key modifier on click", () => {
    const { recorder, events } = createRecorder();
    const btn = document.createElement("button");
    btn.textContent = "Click";
    document.body.appendChild(btn);
    recorder.start();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, metaKey: true }));
    recorder.stop();
    const click = events.find((e) => e.type === "click");
    expect(click!.data).toMatchObject({ modifiers: { alt: false, ctrl: false, meta: true, shift: false } });
  });

  it("captures non-primary mouse button clicks", () => {
    const { recorder, events } = createRecorder();
    const btn = document.createElement("button");
    btn.textContent = "Right";
    document.body.appendChild(btn);
    recorder.start();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 2 }));
    recorder.stop();
    const click = events.find((e) => e.type === "click");
    expect(click!.data).toMatchObject({ button: 2 });
  });

  // ------------------------------------------------------------------
  // Textarea input events
  // ------------------------------------------------------------------

  it("captures textarea input events", () => {
    const { recorder, events } = createRecorder();
    const textarea = document.createElement("textarea");
    textarea.name = "bio";
    document.body.appendChild(textarea);
    recorder.start();
    textarea.value = "some text";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    recorder.stop();
    const inputs = events.filter((e) => e.type === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].data).toMatchObject({ type: "textarea", source: "input", name: "bio" });
  });

  // ------------------------------------------------------------------
  // Custom now() and idFactory overrides
  // ------------------------------------------------------------------

  it("uses custom now() for timestamps", () => {
    let ts = 1000;
    const { recorder, events } = createRecorder({ now: () => ts });
    recorder.start();
    expect(events[0].timestamp).toBe(1000);
    ts = 5000;
    recorder.stop();
    expect(events[events.length - 1].timestamp).toBe(5000);
  });

  it("uses custom idFactory for event ids", () => {
    let counter = 0;
    const { recorder, events } = createRecorder({ idFactory: () => `custom-${++counter}` });
    recorder.start();
    recorder.stop();
    expect(events[0].id).toBe("custom-1");
    expect(events[events.length - 1].id).toBe("custom-2");
  });

  // ------------------------------------------------------------------
  // isActive() and eventCount() state accessors
  // ------------------------------------------------------------------

  it("isActive() returns false before start and after stop", () => {
    const { recorder } = createRecorder();
    expect(recorder.isActive()).toBe(false);
    recorder.start();
    expect(recorder.isActive()).toBe(true);
    recorder.stop();
    expect(recorder.isActive()).toBe(false);
  });

  it("eventCount() tracks total emitted events", () => {
    const { recorder } = createRecorder();
    expect(recorder.eventCount()).toBe(0);
    recorder.start();
    expect(recorder.eventCount()).toBe(1); // session:start
    recorder.stop();
    expect(recorder.eventCount()).toBe(2); // session:start + session:stop
  });

  // ------------------------------------------------------------------
  // Click event text truncation
  // ------------------------------------------------------------------

  it("truncates click text to 120 characters", () => {
    const { recorder, events } = createRecorder();
    const btn = document.createElement("button");
    btn.textContent = "x".repeat(200);
    document.body.appendChild(btn);
    recorder.start();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    recorder.stop();
    const click = events.find((e) => e.type === "click");
    const clickData = click!.data as ClickEventData;
    expect(clickData.text).toHaveLength(120);
  });

  it("trims whitespace from click text", () => {
    const { recorder, events } = createRecorder();
    const btn = document.createElement("button");
    btn.textContent = "  padded  ";
    document.body.appendChild(btn);
    recorder.start();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    recorder.stop();
    const click = events.find((e) => e.type === "click");
    const clickData = click!.data as ClickEventData;
    expect(clickData.text).toBe("padded");
  });

  // ------------------------------------------------------------------
  // Input event source tracking
  // ------------------------------------------------------------------

  it("tracks change events with source 'change' for input elements", () => {
    const { recorder, events } = createRecorder();
    const input = document.createElement("input");
    input.type = "text";
    input.name = "field";
    document.body.appendChild(input);
    recorder.start();
    input.value = "new value";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    recorder.stop();
    const inputs = events.filter((e) => e.type === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0].data).toMatchObject({ source: "change" });
  });

  // ------------------------------------------------------------------
  // Input type classification
  // ------------------------------------------------------------------

  it("classifies checkbox input type correctly", () => {
    const { recorder, events } = createRecorder();
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "agree";
    document.body.appendChild(input);
    recorder.start();
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    recorder.stop();
    const inputs = events.filter((e) => e.type === "input");
    expect(inputs[0].data).toMatchObject({ type: "checkbox" });
  });

  it("classifies radio input type correctly", () => {
    const { recorder, events } = createRecorder();
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "option";
    document.body.appendChild(input);
    recorder.start();
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    recorder.stop();
    const inputs = events.filter((e) => e.type === "input");
    expect(inputs[0].data).toMatchObject({ type: "radio" });
  });

  it("classifies number input type correctly", () => {
    const { recorder, events } = createRecorder();
    const input = document.createElement("input");
    input.type = "number";
    input.name = "quantity";
    document.body.appendChild(input);
    recorder.start();
    input.value = "42";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    recorder.stop();
    const inputs = events.filter((e) => e.type === "input");
    expect(inputs[0].data).toMatchObject({ type: "number" });
  });

  it("classifies tel input type correctly", () => {
    const { recorder, events } = createRecorder();
    const input = document.createElement("input");
    input.type = "tel";
    input.name = "phone";
    document.body.appendChild(input);
    recorder.start();
    input.value = "+15551234567";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    recorder.stop();
    const inputs = events.filter((e) => e.type === "input");
    expect(inputs[0].data).toMatchObject({ type: "tel" });
  });

  it("classifies unknown input type as 'other'", () => {
    const { recorder, events } = createRecorder();
    const input = document.createElement("input");
    input.type = "date";
    input.name = "birthday";
    document.body.appendChild(input);
    recorder.start();
    input.value = "2000-01-01";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    recorder.stop();
    const inputs = events.filter((e) => e.type === "input");
    expect(inputs[0].data).toMatchObject({ type: "other" });
  });

  // ------------------------------------------------------------------
  // Mutation event content verification
  // ------------------------------------------------------------------

  it("captures addedNodes and removedCount in mutation events", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    const observer = FakeMutationObserver.created[0];
    const target = document.createElement("div");
    const child = document.createElement("span");
    observer.trigger([
      {
        type: "childList",
        target,
        addedNodes: [child] as unknown as NodeList,
        removedNodes: [] as unknown as NodeList,
        previousSibling: null,
        nextSibling: null,
        attributeName: null,
        attributeNamespace: null,
        oldValue: null,
      },
    ]);
    recorder.stop();
    const mutations = events.filter((e) => e.type === "mutation");
    expect(mutations.length).toBeGreaterThanOrEqual(1);
    const mutData = mutations[0].data as Record<string, unknown>;
    expect(mutData.removedCount).toBe(0);
    expect(Array.isArray(mutData.addedNodes)).toBe(true);
  });

  // ------------------------------------------------------------------
  // Non-interactive element clicks are ignored
  // ------------------------------------------------------------------

  it("ignores click events when target is null or no element is hit", () => {
    const { recorder, events } = createRecorder();
    recorder.start();
    // Dispatch on an empty document with bubbles:false so the handler
    // sees event.target as the document itself, which has no parentElement
    // and triggers the early return in the click handler.
    const ev = new MouseEvent("click", { bubbles: false });
    Object.defineProperty(ev, "target", { value: null, writable: false });
    document.dispatchEvent(ev);
    recorder.stop();
    const clicks = events.filter((e) => e.type === "click");
    expect(clicks).toHaveLength(0);
  });
});
