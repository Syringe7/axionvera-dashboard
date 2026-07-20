import { applyNotificationFilter } from '@/notifications/filtering';
import {
  filterFreshNotifications,
  normalizeNotificationInput,
  syncDedupeSets,
  trackNotificationIds,
} from '@/notifications/normalize';
import {
  loadNotificationState,
  saveNotificationState,
} from '@/notifications/persistence';
import { sortByPriority } from '@/notifications/prioritization';
import {
  selectUnreadCount,
  selectVisibleNotifications,
} from '@/notifications/selectors';
import type {
  AppNotification,
  NotificationFilter,
  NotificationInput,
  NotificationState,
} from '@/notifications/types';
import {
  DEFAULT_NOTIFICATION_FILTER,
  NOTIFICATION_STORAGE_VERSION,
} from '@/notifications/types';

const DEFAULT_MAX_ITEMS = 100;
/** Debounce delay (ms) for localStorage writes — batches rapid state changes. */
const PERSIST_DEBOUNCE_MS = 300;

/**
 * Framework-agnostic observable store for the notification center (#268).
 *
 * Consumed via `useSyncExternalStore` in {@link useNotifications}. Persists
 * read/unread and dismissal state to localStorage. Ingestion is idempotent:
 * duplicates (by id or sourceId) are ignored.
 *
 * **Performance notes:**
 * - localStorage writes are debounced to avoid blocking the main thread.
 * - An `indexById` map provides O(1) lookups for single-item mutations.
 * - Filter changes are shallow-compared to avoid unnecessary state copies.
 */
export class NotificationStore {
  private state: NotificationState = {
    items: [],
    filter: DEFAULT_NOTIFICATION_FILTER,
    lastUpdated: null,
  };

  private readonly listeners = new Set<() => void>();
  private readonly seenIds = new Set<string>();
  private readonly seenSourceIds = new Set<string>();
  /** O(1) id → index map kept in sync with `state.items`. */
  private readonly indexById = new Map<string, number>();
  private readonly maxItems: number;
  private hydrated = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private unloadHandlerAttached = false;

  constructor(maxItems: number = DEFAULT_MAX_ITEMS) {
    this.maxItems = maxItems;
    this.subscribe = this.subscribe.bind(this);
    this.getSnapshot = this.getSnapshot.bind(this);
    // Flush pending debounce on tab close to avoid data loss.
    this.handleBeforeUnload = this.handleBeforeUnload.bind(this);
  }

  private handleBeforeUnload(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
      saveNotificationState({
        version: NOTIFICATION_STORAGE_VERSION,
        items: this.state.items,
        filter: this.state.filter,
      });
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): NotificationState {
    return this.state;
  }

  /** Load persisted state from localStorage (browser only, once). */
  hydrate(): void {
    if (this.hydrated || typeof window === 'undefined') return;
    this.hydrated = true;

    // Register unload handler once so pending debounced writes are flushed.
    // Guard against duplicate listeners across reset() → hydrate() cycles.
    if (!this.unloadHandlerAttached) {
      this.unloadHandlerAttached = true;
      window.addEventListener('beforeunload', this.handleBeforeUnload);
    }

    const persisted = loadNotificationState();
    if (!persisted) return;

    trackNotificationIds(persisted.items, this.seenIds, this.seenSourceIds);

    const items = sortByPriority(persisted.items);
    this.state = {
      items,
      filter: persisted.filter,
      lastUpdated: Date.now(),
    };
    this.rebuildIndex(items);
  }

  /** Visible notifications matching the active filter, priority-sorted. */
  getVisibleNotifications(): AppNotification[] {
    return selectVisibleNotifications(this.state.items, this.state.filter);
  }

  getUnreadCount(): number {
    return selectUnreadCount(this.state.items);
  }

  addNotification(input: NotificationInput): void {
    this.addNotifications([input]);
  }

  addNotifications(incoming: NotificationInput[]): void {
    const fresh = filterFreshNotifications(
      incoming,
      this.seenIds,
      this.seenSourceIds,
    );
    if (fresh.length === 0) return;

    const normalized = fresh.map(normalizeNotificationInput);
    trackNotificationIds(normalized, this.seenIds, this.seenSourceIds);

    const merged = sortByPriority([...normalized, ...this.state.items]).slice(
      0,
      this.maxItems,
    );

    syncDedupeSets(merged, this.seenIds, this.seenSourceIds);
    this.commit({ items: merged });
  }

  markAsRead(id: string): void {
    this.updateItem(id, (item) => ({ ...item, read: true }));
  }

  markAllAsRead(): void {
    if (!this.state.items.some((n) => !n.read && !n.dismissed)) return;

    this.commit({
      items: this.state.items.map((n) =>
        n.dismissed ? n : { ...n, read: true },
      ),
    });
  }

  dismiss(id: string): void {
    this.updateItem(id, (item) => ({ ...item, dismissed: true, read: true }));
  }

  dismissAllVisible(): void {
    const visibleIds = new Set(
      applyNotificationFilter(this.state.items, this.state.filter).map((n) => n.id),
    );
    if (visibleIds.size === 0) return;

    this.commit({
      items: this.state.items.map((n) =>
        visibleIds.has(n.id) ? { ...n, dismissed: true, read: true } : n,
      ),
    });
  }

  setFilter(filter: Partial<NotificationFilter>): void {
    const next = { ...this.state.filter, ...filter };
    // Shallow-compare to avoid triggering listeners when values unchanged.
    if (
      next.category === this.state.filter.category &&
      next.read === this.state.filter.read
    ) {
      return;
    }
    this.commit({ filter: next });
  }

  clearDismissed(): void {
    const remaining = this.state.items.filter((n) => !n.dismissed);
    if (remaining.length === this.state.items.length) return;

    syncDedupeSets(remaining, this.seenIds, this.seenSourceIds);
    this.commit({ items: remaining });
  }

  /** Test helper — reset in-memory state. */
  reset(): void {
    this.seenIds.clear();
    this.seenSourceIds.clear();
    this.indexById.clear();
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.hydrated = false;
    this.state = {
      items: [],
      filter: DEFAULT_NOTIFICATION_FILTER,
      lastUpdated: null,
    };
    this.emit();
  }

  private updateItem(
    id: string,
    updater: (item: AppNotification) => AppNotification,
  ): void {
    const index = this.indexById.get(id) ?? -1;
    if (index === -1) return;

    const items = [...this.state.items];
    items[index] = updater(items[index]);
    this.commit({ items });
  }

  private commit(partial: Partial<Pick<NotificationState, 'items' | 'filter'>>): void {
    this.state = {
      ...this.state,
      ...partial,
      lastUpdated: Date.now(),
    };
    if (partial.items) this.rebuildIndex(partial.items);
    this.schedulePersist();
    this.emit();
  }

  /** Rebuild the O(1) id → index map after items change. */
  private rebuildIndex(items: AppNotification[]): void {
    this.indexById.clear();
    for (let i = 0; i < items.length; i++) {
      this.indexById.set(items[i].id, i);
    }
  }

  /** Debounced localStorage write — batches rapid mutations. */
  private schedulePersist(): void {
    if (this.persistTimer !== null) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      saveNotificationState({
        version: NOTIFICATION_STORAGE_VERSION,
        items: this.state.items,
        filter: this.state.filter,
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb());
  }
}

/** Shared store instance used across the dashboard. */
export const notificationStore = new NotificationStore();

/** Imperative API for pushing notifications from hooks, contexts, or adapters. */
export function pushNotification(input: NotificationInput): void {
  notificationStore.hydrate();
  notificationStore.addNotification(input);
}

export function pushNotifications(inputs: NotificationInput[]): void {
  notificationStore.hydrate();
  notificationStore.addNotifications(inputs);
}
