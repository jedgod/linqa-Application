import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { REMIND_BEFORE_MINUTES, reminderAt } from "./workspace-model";

/**
 * Event reminders are local notifications scheduled on this phone, so no one else is told and no server is involved. The
 * notification never contains the event's title or place (those are encrypted), so nothing private shows on a locked screen.
 * The set of scheduled reminders is the source of truth: there is nothing else to keep in step.
 */
const prefix = "linqa-event:";
const idOf = (eventId: string) => prefix + eventId;
const CHANNEL = "event-reminders";

export type ReminderResult = "set" | "too-soon" | "denied";

/** The ids of events that currently have a reminder scheduled. */
export async function eventsWithReminders(): Promise<Set<string>> {
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    return new Set(all.filter((n) => n.identifier.startsWith(prefix)).map((n) => n.identifier.slice(prefix.length)));
  } catch { return new Set(); }
}

export async function setReminder(eventId: string, startsAt: string): Promise<ReminderResult> {
  const at = reminderAt(startsAt);
  if (!at) return "too-soon";
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync(CHANNEL, { name: "Event reminders", importance: Notifications.AndroidImportance.DEFAULT });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return "denied";
  await Notifications.cancelScheduledNotificationAsync(idOf(eventId)).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: idOf(eventId),
    content: { title: `Event in ${REMIND_BEFORE_MINUTES} minutes`, body: "Open Linqa to see details.", data: { kind: "calendar-event", id: eventId } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL }
  });
  return "set";
}

export async function clearReminder(eventId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(idOf(eventId)).catch(() => undefined);
}
