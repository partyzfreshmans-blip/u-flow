// Persisted notification events — "new order arrived" and "sync failed" are
// genuine one-time occurrences, so they're appended to an event log the
// moment they happen (unlike the standing-condition items — stuck orders,
// overdue payments — which derive.ts recomputes fresh from current data on
// every render instead).

export type NotificationEventKind = 'new-order' | 'sync-error';

export interface NotificationEvent {
  id: string;
  kind: NotificationEventKind;
  message: string;
  createdAt: number;
  orderNo?: string;
}

const EVENTS_KEY = 'warehouse-ops.notificationEvents.v1';
const READ_IDS_KEY = 'warehouse-ops.notificationReadIds.v1';
const MAX_EVENTS = 100;

export function loadNotificationEvents(): NotificationEvent[] {
  try {
    const raw = localStorage.getItem(EVENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NotificationEvent[]) : [];
  } catch {
    return [];
  }
}

function saveNotificationEvents(events: NotificationEvent[]): void {
  try {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
  } catch {
    /* storage unavailable (private mode) — events stay in memory for this session */
  }
}

/** Appends one or more new events (newest first) and persists the trimmed
 * result, returning it so the caller can push it straight into state. */
export function appendNotificationEvents(existing: NotificationEvent[], added: Omit<NotificationEvent, 'id' | 'createdAt'>[]): NotificationEvent[] {
  const now = Date.now();
  const full: NotificationEvent[] = added.map((a, i) => ({ ...a, id: `${now}-${i}-${Math.random().toString(36).slice(2, 8)}`, createdAt: now }));
  const next = [...full, ...existing].slice(0, MAX_EVENTS);
  saveNotificationEvents(next);
  return next;
}

export function loadNotificationReadIds(): string[] {
  try {
    const raw = localStorage.getItem(READ_IDS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function saveNotificationReadIds(ids: string[]): void {
  try {
    // Capped generously — read-ids for standing-condition items (stuck
    // orders, overdue payments) churn as those get resolved, so this trims
    // the oldest rather than growing forever.
    localStorage.setItem(READ_IDS_KEY, JSON.stringify(ids.slice(-500)));
  } catch {
    /* storage unavailable (private mode) — read state stays in memory for this session */
  }
}
