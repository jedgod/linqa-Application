// Adds events and meetings to the phone's calendar and schedules local
// reminders. Reminders never include the title unless the user allowed
// message previews, so nothing private shows on a locked screen.

import * as Calendar from "expo-calendar";
import * as Notifications from "expo-notifications";
import { EventContent, MeetingContent } from "../../content/types";
import { meetingEnd } from "./scheduleModel";

const REMIND_BEFORE_MIN = 15;

export async function addToCalendar(item: EventContent | MeetingContent): Promise<"added" | "denied"> {
  const perm = await Calendar.requestCalendarPermissionsAsync();
  if (!perm.granted) return "denied";
  const cal = await Calendar.getDefaultCalendarAsync().catch(async () => {
    const all = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    return all.find((x) => x.allowsModifications) ?? all[0];
  });
  const isMeeting = item.type === "meeting";
  await Calendar.createEventAsync(cal.id, {
    title: item.title,
    startDate: new Date(item.startsAt),
    endDate: new Date(isMeeting ? meetingEnd(item) : Date.parse((item as EventContent).endsAt)),
    allDay: !isMeeting && (item as EventContent).allDay,
    location: isMeeting ? "Linqa encrypted call" : (item as EventContent).place,
    notes: item.note,
    alarms: [{ relativeOffset: -REMIND_BEFORE_MIN }],
  });
  return "added";
}

export async function scheduleReminder(item: EventContent | MeetingContent, showPreview: boolean): Promise<string | null> {
  const at = Date.parse(item.startsAt) - REMIND_BEFORE_MIN * 60_000;
  if (at <= Date.now()) return null;
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return null;
  const isMeeting = item.type === "meeting";
  return Notifications.scheduleNotificationAsync({
    content: {
      title: isMeeting ? "Meeting in 15 minutes" : "Event in 15 minutes",
      body: showPreview ? item.title : "Open Linqa to see details",
      data: { kind: item.type, id: isMeeting ? item.meetingId : (item as EventContent).eventId },
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at) },
  });
}

export async function cancelReminder(notificationId: string) {
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
