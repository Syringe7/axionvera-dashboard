import type { AppNotification, NotificationInput } from './types';

/** Applies defaults for optional ingest fields. */
export function normalizeNotificationInput(input: NotificationInput): AppNotification {
  return {
    ...input,
    read: input.read ?? false,
    dismissed: input.dismissed ?? false,
  };
}

/** Returns inputs that are not already tracked by id or sourceId. */
export function filterFreshNotifications(
  incoming: NotificationInput[],
  seenIds: ReadonlySet<string>,
  seenSourceIds: ReadonlySet<string>,
): NotificationInput[] {
  return incoming.filter((n) => {
    if (seenIds.has(n.id)) return false;
    if (n.sourceId && seenSourceIds.has(n.sourceId)) return false;
    return true;
  });
}

/** Registers ids from notifications into dedupe sets. */
export function trackNotificationIds(
  items: AppNotification[],
  seenIds: Set<string>,
  seenSourceIds: Set<string>,
): void {
  items.forEach((n) => {
    seenIds.add(n.id);
    if (n.sourceId) seenSourceIds.add(n.sourceId);
  });
}

/**
 * Prunes dedupe sets to match retained notifications after capping.
 * Single-pass: builds retained sets inline, then filters both seen sets.
 */
export function syncDedupeSets(
  items: AppNotification[],
  seenIds: Set<string>,
  seenSourceIds: Set<string>,
): void {
  const retainedIds = new Set<string>();
  const retainedSources = new Set<string>();
  for (const n of items) {
    retainedIds.add(n.id);
    if (n.sourceId) retainedSources.add(n.sourceId);
  }

  for (const id of seenIds) {
    if (!retainedIds.has(id)) seenIds.delete(id);
  }
  for (const sourceId of seenSourceIds) {
    if (!retainedSources.has(sourceId)) seenSourceIds.delete(sourceId);
  }
}
