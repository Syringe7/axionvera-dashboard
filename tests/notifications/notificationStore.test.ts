import { NotificationStore } from '@/store/notificationStore';
import type { NotificationInput } from '@/notifications/types';
import {
  clearNotificationStorage,
  loadNotificationState,
} from '@/notifications/persistence';

function makeNotification(
  id: string,
  overrides: Partial<NotificationInput> = {},
): NotificationInput {
  return {
    id,
    category: 'transaction',
    priority: 'normal',
    title: `Notification ${id}`,
    message: `Message for ${id}`,
    timestamp: '2026-06-28T12:00:00.000Z',
    ...overrides,
  };
}

describe('NotificationStore', () => {
  beforeEach(() => {
    clearNotificationStorage();
    localStorage.clear();
  });

  it('starts empty with default filter', () => {
    const store = new NotificationStore();
    expect(store.getSnapshot().items).toEqual([]);
    expect(store.getVisibleNotifications()).toEqual([]);
    expect(store.getUnreadCount()).toBe(0);
  });

  it('orders by priority then timestamp', () => {
    const store = new NotificationStore();
    store.addNotifications([
      makeNotification('low', {
        priority: 'low',
        timestamp: '2026-06-28T14:00:00.000Z',
      }),
      makeNotification('critical', {
        priority: 'critical',
        timestamp: '2026-06-28T10:00:00.000Z',
      }),
      makeNotification('high', {
        priority: 'high',
        timestamp: '2026-06-28T13:00:00.000Z',
      }),
    ]);

    expect(store.getVisibleNotifications().map((n) => n.id)).toEqual([
      'critical',
      'high',
      'low',
    ]);
  });

  it('ignores duplicate ids and sourceIds', () => {
    const store = new NotificationStore();
    store.addNotification(makeNotification('a', { sourceId: 'evt-1' }));
    store.addNotification(makeNotification('a'));
    store.addNotification(makeNotification('b', { sourceId: 'evt-1' }));
    expect(store.getSnapshot().items).toHaveLength(1);
  });

  it('tracks read and unread counts', () => {
    const store = new NotificationStore();
    store.addNotifications([makeNotification('a'), makeNotification('b')]);
    expect(store.getUnreadCount()).toBe(2);

    store.markAsRead('a');
    expect(store.getUnreadCount()).toBe(1);

    store.markAllAsRead();
    expect(store.getUnreadCount()).toBe(0);
  });

  it('dismisses notifications and hides them from visible list', () => {
    const store = new NotificationStore();
    store.addNotifications([makeNotification('a'), makeNotification('b')]);
    store.dismiss('a');

    const visible = store.getVisibleNotifications();
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe('b');
    expect(store.getSnapshot().items.find((n) => n.id === 'a')?.dismissed).toBe(true);
  });

  it('filters by category and read state', () => {
    const store = new NotificationStore();
    store.addNotifications([
      makeNotification('tx', { category: 'transaction' }),
      makeNotification('gov', { category: 'governance', priority: 'high' }),
    ]);
    store.markAsRead('tx');

    store.setFilter({ category: 'governance', read: 'all' });
    expect(store.getVisibleNotifications().map((n) => n.id)).toEqual(['gov']);

    store.setFilter({ category: 'all', read: 'unread' });
    expect(store.getVisibleNotifications().map((n) => n.id)).toEqual(['gov']);

    store.setFilter({ category: 'all', read: 'read' });
    expect(store.getVisibleNotifications().map((n) => n.id)).toEqual(['tx']);
  });

  it('persists read/unread state to localStorage', () => {
    jest.useFakeTimers();
    try {
      const store = new NotificationStore();
      store.addNotification(makeNotification('persist-me'));
      store.markAsRead('persist-me');

      // Advance past the debounce delay so the write fires.
      jest.advanceTimersByTime(350);

      const persisted = loadNotificationState();
      expect(persisted?.items.find((n) => n.id === 'persist-me')?.read).toBe(true);

      const reloaded = new NotificationStore();
      reloaded.hydrate();
      expect(reloaded.getSnapshot().items.find((n) => n.id === 'persist-me')?.read).toBe(
        true,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('notifies subscribers on changes', () => {
    const store = new NotificationStore();
    const listener = jest.fn();
    store.subscribe(listener);
    store.addNotification(makeNotification('x'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('caps retained notifications', () => {
    const store = new NotificationStore(2);
    store.addNotifications([
      makeNotification('a'),
      makeNotification('b'),
      makeNotification('c'),
    ]);
    expect(store.getSnapshot().items).toHaveLength(2);
  });
});
