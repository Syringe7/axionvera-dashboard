import { IndexedDBSessionStore } from "@/session";
import type { SessionEvent, SessionMetadata } from "@/session";
import { FakeIDBFactory } from "../utils/fakeIndexedDB";

const createStoreFactory = () => {
  // The production `IndexedDBSessionStore` accepts a real `IDBFactory`.
  // `FakeIDBFactory` satisfies the structural shape but is a declared class,
  // so we erase the nominal class type at the boundary to keep the rest of
  // the tests free of `as unknown` casts.
  const idbFactory = new FakeIDBFactory() as unknown as IDBFactory;
  return { idbFactory };
};

/**
 * `idbFactory.open()` returns a request object, not a promise. Awaiting
 * non-Promise values in `async` tests is a silent no-op, so we provide a
 * helper that turns the request's `onsuccess` into a real Promise.
 */
const openDatabase = (
  idbFactory: IDBFactory,
  name: string,
  version: number,
): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const request = idbFactory.open(name, version);
    request.onupgradeneeded = () => {
      /* no-op: production handler runs via store.init() */
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("open failed"));
    request.onblocked = () => reject(new Error("open blocked"));
  });

const makeMetadata = (id: string, overrides: Partial<SessionMetadata> = {}): SessionMetadata => ({
  id,
  startedAt: 1000,
  endedAt: 2000,
  url: "https://example.com",
  userAgent: "Jest",
  events: 0,
  ...overrides,
});

const makeEvent = (sessionId: string, index: number, type: SessionEvent["type"] = "click"): SessionEvent => ({
  id: `${sessionId}-evt-${index}`,
  sessionId,
  type,
  timestamp: 1000 + index,
  data: { selector: `a:nth-of-type(${index + 1})`, text: "x", x: 0, y: 0, button: 0, modifiers: { alt: false, ctrl: false, meta: false, shift: false } },
});

describe("IndexedDBSessionStore", () => {
  it("opens the database and provisions the schema on first init", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    const db = (await openDatabase(idbFactory, "axionvera_sessions", 1)) as {
      objectStoreNames: { contains(name: string): boolean };
    };
    expect(db.objectStoreNames.contains("sessions")).toBe(true);
    expect(db.objectStoreNames.contains("events")).toBe(true);
    await store.close();
  });

  it("saves and reads metadata", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    const meta = makeMetadata("s1");
    await store.saveMetadata(meta);
    const fetched = await store.getMetadata("s1");
    expect(fetched).toEqual(meta);
    await store.close();
  });

  it("lists metadata sorted by startedAt descending", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveMetadata(makeMetadata("a", { startedAt: 100 }));
    await store.saveMetadata(makeMetadata("b", { startedAt: 200 }));
    const list = await store.listMetadata();
    expect(list.map((m) => m.id)).toEqual(["b", "a"]);
    await store.close();
  });

  it("saves and reads events sorted by timestamp", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveEvents([makeEvent("s1", 4), makeEvent("s1", 1), makeEvent("s1", 2)]);
    const events = await store.getEvents("s1");
    expect(events.map((e) => e.timestamp)).toEqual([1001, 1002, 1004]);
    await store.close();
  });

  it("filters events by type and timestamp range", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveEvents([
      makeEvent("s1", 0, "click"),
      makeEvent("s1", 1, "navigation"),
      makeEvent("s1", 2, "click"),
      makeEvent("s1", 3, "click"),
    ]);
    const clicks = await store.getEvents("s1", { type: "click" });
    expect(clicks).toHaveLength(3);
    const middle = await store.getEvents("s1", { fromTimestamp: 1002, toTimestamp: 1002 });
    expect(middle).toHaveLength(1);
    await store.close();
  });

  it("deletes a session (metadata + events)", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveMetadata(makeMetadata("s1"));
    await store.saveEvents([makeEvent("s1", 0), makeEvent("s1", 1)]);
    await store.deleteSession("s1");
    expect(await store.getMetadata("s1")).toBeNull();
    expect(await store.getEvents("s1")).toEqual([]);
    await store.close();
  });

  it("rotate() removes sessions older than maxRetainedAgeMs", async () => {
    const { idbFactory } = createStoreFactory();
    const now = 10_000;
    const store = new IndexedDBSessionStore({
      indexedDBFactory: idbFactory,
      maxRetainedAgeMs: 1000,
      now: () => now,
    });
    await store.init();
    await store.saveMetadata(makeMetadata("old", { startedAt: 0, endedAt: 0 }));
    await store.saveMetadata(makeMetadata("new", { startedAt: 9500, endedAt: 9700 }));
    await store.rotate();
    const list = await store.listMetadata();
    expect(list.map((m) => m.id)).toEqual(["new"]);
    await store.close();
  });

  it("rotate() keeps at most maxRetainedSessions surviving records", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({
      indexedDBFactory: idbFactory,
      maxRetainedSessions: 2,
      maxRetainedAgeMs: Number.MAX_SAFE_INTEGER,
    });
    await store.init();
    await store.saveMetadata(makeMetadata("a", { startedAt: 100, endedAt: 100 }));
    await store.saveMetadata(makeMetadata("b", { startedAt: 200, endedAt: 200 }));
    await store.saveMetadata(makeMetadata("c", { startedAt: 300, endedAt: 300 }));
    await store.rotate();
    const list = await store.listMetadata();
    expect(list.map((m) => m.id).sort()).toEqual(["b", "c"]);
    await store.close();
  });

  it("exports a session as a JSON-shaped payload", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveMetadata(makeMetadata("s1"));
    await store.saveEvents([makeEvent("s1", 0)]);
    const payload = await store.exportSessionJSON("s1");
    expect(payload).not.toBeNull();
    expect(payload!.metadata.id).toBe("s1");
    expect(payload!.events).toHaveLength(1);
    expect(payload!.events[0].sessionId).toBe("s1");
    const blob = await store.exportSessionBlob("s1");
    expect(blob).toBeInstanceOf(Blob);
    await store.close();
  });

  it("exportSessionJSON returns null for unknown sessions", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    expect(await store.exportSessionJSON("nope")).toBeNull();
    await store.close();
  });

  it("throws if no indexedDB factory is provided and no global is available", async () => {
    const originalIndexedDB = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    try {
      // Temporarily strip the global that the test setup may install.
      delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      const store = new IndexedDBSessionStore();
      await expect(store.init()).rejects.toThrow(/IndexedDB is unavailable/);
    } finally {
      if (originalIndexedDB) {
        (globalThis as { indexedDB?: IDBFactory }).indexedDB = originalIndexedDB;
      }
    }
  });

  // ------------------------------------------------------------------
  // Limit filter on getEvents
  // ------------------------------------------------------------------

  it("getEvents respects the limit filter", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveEvents([
      makeEvent("s1", 0, "click"),
      makeEvent("s1", 1, "click"),
      makeEvent("s1", 2, "click"),
      makeEvent("s1", 3, "click"),
    ]);
    const limited = await store.getEvents("s1", { limit: 2 });
    expect(limited).toHaveLength(2);
    await store.close();
  });

  it("getEvents with limit=0 returns empty array", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveEvents([makeEvent("s1", 0)]);
    const limited = await store.getEvents("s1", { limit: 0 });
    expect(limited).toHaveLength(0);
    await store.close();
  });

  // ------------------------------------------------------------------
  // saveEvent (single event)
  // ------------------------------------------------------------------

  it("saveEvent persists a single event", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveEvent(makeEvent("s1", 0));
    const events = await store.getEvents("s1");
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe("s1-evt-0");
    await store.close();
  });

  // ------------------------------------------------------------------
  // rotate edge cases
  // ------------------------------------------------------------------

  it("rotate() does nothing when all sessions are within retention", async () => {
    const { idbFactory } = createStoreFactory();
    const now = 10_000;
    const store = new IndexedDBSessionStore({
      indexedDBFactory: idbFactory,
      maxRetainedAgeMs: 100_000,
      maxRetainedSessions: 100,
      now: () => now,
    });
    await store.init();
    await store.saveMetadata(makeMetadata("s1", { startedAt: 5000, endedAt: 6000 }));
    await store.saveMetadata(makeMetadata("s2", { startedAt: 7000, endedAt: 8000 }));
    await store.rotate();
    const list = await store.listMetadata();
    expect(list).toHaveLength(2);
    await store.close();
  });

  it("rotate() removes both old and excess sessions", async () => {
    const { idbFactory } = createStoreFactory();
    const now = 10_000;
    const store = new IndexedDBSessionStore({
      indexedDBFactory: idbFactory,
      maxRetainedSessions: 1,
      maxRetainedAgeMs: 5000,
      now: () => now,
    });
    await store.init();
    // old session
    await store.saveMetadata(makeMetadata("old", { startedAt: 1000, endedAt: 1500 }));
    // recent but exceeds maxRetainedSessions
    await store.saveMetadata(makeMetadata("new1", { startedAt: 6000, endedAt: 7000 }));
    await store.saveMetadata(makeMetadata("new2", { startedAt: 8000, endedAt: 9000 }));
    await store.rotate();
    const list = await store.listMetadata();
    expect(list.map((m) => m.id)).toEqual(["new2"]); // kept: newest within age & count limit
    await store.close();
  });

  // ------------------------------------------------------------------
  // close() when no db is open
  // ------------------------------------------------------------------

  it("close() is safe to call when no database is open", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    // close() without init() should not throw
    await expect(store.close()).resolves.not.toThrow();
  });

  // ------------------------------------------------------------------
  // getMetadata for unknown session
  // ------------------------------------------------------------------

  it("getMetadata returns null for unknown session id", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    expect(await store.getMetadata("nonexistent")).toBeNull();
    await store.close();
  });

  // ------------------------------------------------------------------
  // getEvents for unknown session
  // ------------------------------------------------------------------

  it("getEvents returns empty array for unknown session id", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    const events = await store.getEvents("nonexistent");
    expect(events).toEqual([]);
    await store.close();
  });

  // ------------------------------------------------------------------
  // listMetadata with no records
  // ------------------------------------------------------------------

  it("listMetadata returns empty array when no sessions exist", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    const list = await store.listMetadata();
    expect(list).toEqual([]);
    await store.close();
  });

  // ------------------------------------------------------------------
  // saveEvents with empty array is a no-op
  // ------------------------------------------------------------------

  it("saveEvents with empty array does not open a transaction", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    // Should not throw or open a transaction
    await store.saveEvents([]);
    await store.close();
  });

  // ------------------------------------------------------------------
  // exportSessionBlob produces a Blob with correct MIME type
  // ------------------------------------------------------------------

  it("exportSessionBlob returns a JSON blob when session exists", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveMetadata(makeMetadata("s1"));
    await store.saveEvents([makeEvent("s1", 0)]);
    const blob = await store.exportSessionBlob("s1");
    expect(blob).toBeInstanceOf(Blob);
    expect(blob!.type).toBe("application/json");
    await store.close();
  });

  it("exportSessionBlob returns null for unknown session", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    expect(await store.exportSessionBlob("nope")).toBeNull();
    await store.close();
  });

  // ------------------------------------------------------------------
  // saveMetadata is idempotent (put replaces existing)
  // ------------------------------------------------------------------

  it("saveMetadata replaces an existing record with the same id", async () => {
    const { idbFactory } = createStoreFactory();
    const store = new IndexedDBSessionStore({ indexedDBFactory: idbFactory });
    await store.init();
    await store.saveMetadata(makeMetadata("s1", { label: "v1" }));
    await store.saveMetadata(makeMetadata("s1", { label: "v2" }));
    const meta = await store.getMetadata("s1");
    expect(meta).not.toBeNull();
    expect(meta!.label).toBe("v2");
    await store.close();
  });
});
