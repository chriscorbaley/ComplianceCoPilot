// Thin, crash-safe wrapper around expo-notifications. Local scheduled
// notifications work in a dev/standalone build; in Expo Go remote push is
// limited, so every call is wrapped in try/catch and simply no-ops on failure.
// Used for the document-retention deletion reminders (Feature 4).

import * as Notifications from 'expo-notifications';

// Stable identifier for the weekly retention reminder so re-scheduling replaces
// rather than stacks duplicates.
const RETENTION_ID = 'ccp-retention-weekly';

let handlerSet = false;

function ensureHandler(): void {
  if (handlerSet) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    handlerSet = true;
  } catch {
    // Older/newer SDK shape — fall back silently.
    handlerSet = true;
  }
}

// Requests OS notification permission. Returns true when granted. Safe to call
// repeatedly; never throws.
export async function requestNotificationPermission(): Promise<boolean> {
  try {
    ensureHandler();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return Boolean(req.granted);
  } catch {
    return false;
  }
}

export async function hasNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    return Boolean(current.granted);
  } catch {
    return false;
  }
}

// Schedules (or replaces) the weekly Monday 9am document-retention reminder.
// No-ops when permission is missing or notifications are unavailable.
export async function scheduleRetentionReminder(
  title: string,
  body: string,
): Promise<void> {
  try {
    ensureHandler();
    if (!(await hasNotificationPermission())) return;
    await Notifications.cancelScheduledNotificationAsync(RETENTION_ID).catch(
      () => undefined,
    );
    await Notifications.scheduleNotificationAsync({
      identifier: RETENTION_ID,
      content: { title, body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
        // Expo weekday: 1 = Sunday … 2 = Monday.
        weekday: 2,
        hour: 9,
        minute: 0,
      },
    });
  } catch {
    // Ignore — reminders are best-effort.
  }
}

export async function cancelRetentionReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(RETENTION_ID);
  } catch {
    // Ignore.
  }
}
