// Adds events and meetings to the phone's calendar and schedules local
// reminders. Reminders never include the title unless the user allowed
// message previews, so nothing private shows on a locked screen.

import * as Calendar from "expo-calendar/legacy";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { EventContent, MeetingContent } from "../../content/types";
import { meetingEnd } from "./scheduleModel";

const REMIND_BEFORE_MIN = 15;

// Which events and meetings this phone has already put on its calendar, so the card says so and a second tap does not add a copy.
const ADDED_KEY = "linqa.calendar.added.v1";
const added = new Set<string>();
let loaded: Promise<void> | null = null;
const idOf = (item: EventContent | MeetingContent) => (item.type === "meeting" ? item.meetingId : (item as EventContent).eventId);
const load = () => (loaded ??= SecureStore.getItemAsync(ADDED_KEY).then((raw) => { try { for (const id of JSON.parse(raw ?? "[]") as string[]) added.add(id); } catch { /* start empty */ } }, () => undefined));

export async function wasAddedToCalendar(item: EventContent | MeetingContent): Promise<boolean> {
  await load();
  return added.has(idOf(item));
}

async function rememberAdded(item: EventContent | MeetingContent) {
  added.add(idOf(item));
  await SecureStore.setItemAsync(ADDED_KEY, JSON.stringify([...added].slice(-300))).catch(() => undefined);
}

/**
 * Puts an event or meeting on the phone's calendar. It first tries to save it straight into a calendar the person can edit; if the
 * phone has none, or saving fails, it opens the phone's own calendar screen with the details filled in, so it can still be saved there.
 * "cancelled" means the person closed that screen without saving.
 */
export async function addToCalendar(item: EventContent | MeetingContent): Promise<"added" | "denied" | "cancelled"> {
  const isMeeting = item.type === "meeting";
  const start = new Date(item.startsAt);
  const end = new Date(isMeeting ? meetingEnd(item) : Date.parse((item as EventContent).endsAt));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("INVALID_DATES");
  const details = {
    title: item.title,
    startDate: start,
    endDate: end,
    allDay: !isMeeting && Boolean((item as EventContent).allDay),
    location: isMeeting ? "Linqa encrypted call" : (item as EventContent).place,
    notes: item.note,
    // Android will not create an event without a time zone.
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    alarms: [{ relativeOffset: -REMIND_BEFORE_MIN }],
  };
  try {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.granted) {
      const primary = await Calendar.getDefaultCalendarAsync().catch(() => null);
      const cal = primary?.allowsModifications ? primary : (await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)).find(x => x.allowsModifications);
      if (cal) {
        await Calendar.createEventAsync(cal.id, details);
        await rememberAdded(item);
        return "added";
      }
    }
  } catch { /* fall through to the phone's own calendar screen */ }
  const result = await Calendar.createEventInCalendarAsync(details);
  if (result.action === "saved" || result.action === "done") { await rememberAdded(item); return "added"; }
  return "cancelled";
}

export async function scheduleReminder(item: EventContent | MeetingContent, showPreview: boolean): Promise<string | null> {
  const at = Date.parse(item.startsAt) - REMIND_BEFORE_MIN * 60_000;
  if (at <= Date.now()) return null;
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("chat-reminders", {name:"Chat reminders", importance:Notifications.AndroidImportance.DEFAULT});
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return null;
  const isMeeting = item.type === "meeting";
  return Notifications.scheduleNotificationAsync({
    identifier: `linqa-reminder:${isMeeting ? item.meetingId : (item as EventContent).eventId}`,
    content: {
      title: isMeeting ? "Meeting in 15 minutes" : "Event in 15 minutes",
      body: showPreview ? item.title : "Open Linqa to see details",
      data: { kind: item.type, id: isMeeting ? item.meetingId : (item as EventContent).eventId },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: "chat-reminders" },
  });
}

export async function cancelReminder(notificationId: string) {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
