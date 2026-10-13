// Adds events and meetings to the phone's calendar and schedules local
// reminders. Reminders never include the title unless the user allowed
// message previews, so nothing private shows on a locked screen.

import * as Calendar from "expo-calendar/legacy";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { EventContent, MeetingContent } from "../../content/types";
import { utf8 } from "../../../../services/secure-core";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { accountScopeGeneration, registerAccountScopeReset } from "../../../../services/account-scope";
import { hasEventEnded, meetingEnd } from "./scheduleModel";

const REMIND_BEFORE_MIN = 15;

// Which events and meetings this phone has already put on its calendar, so the card says so and a second tap does not add a copy.
const ADDED_KEY = "linqa.calendar.added.v1";
type CalendarOutcome='added'|'denied'|'cancelled'|'opened'|'past';
const added=new Set<string>();
const pending=new Map<string,Promise<CalendarOutcome>>();
const idOf=(item:EventContent|MeetingContent)=>item.type+':'+(item.type==='meeting'?item.meetingId:item.eventId);
function keyOf(item:EventContent|MeetingContent,userId:string):string {
 if(!/^[A-Za-z0-9-]{1,100}$/.test(userId))throw new Error('EVENT_ACCOUNT_REQUIRED');
 return ADDED_KEY+'.'+userId+'.'+bytesToHex(sha256(utf8(idOf(item))));
}
registerAccountScopeReset('calendar-added',()=>{added.clear();});
export async function wasAddedToCalendar(item:EventContent|MeetingContent,userId:string):Promise<boolean> {
 const key=keyOf(item,userId);if(added.has(key))return true;
 const saved=await SecureStore.getItemAsync(key);if(saved==='on')added.add(key);return saved==='on';
}
async function rememberAdded(item:EventContent|MeetingContent,userId:string){
 const key=keyOf(item,userId);added.add(key);
 // A calendar write already succeeded. A storage failure must not open a
 // second insert dialog for that same event.
 await SecureStore.setItemAsync(key,'on').catch(()=>undefined);
}
export function addToCalendar(item:EventContent|MeetingContent,userId:string):Promise<CalendarOutcome> {
 const key=keyOf(item,userId);if(hasEventEnded(item))return Promise.resolve('past');const existing=pending.get(key);if(existing)return existing;
 const generation=accountScopeGeneration();
 const result=(async()=>{if(await wasAddedToCalendar(item,userId))return 'added' as const;return createCalendarEvent(item,userId,generation);})();
 pending.set(key,result);void result.finally(()=>{if(pending.get(key)===result)pending.delete(key);}).catch(()=>undefined);return result;
}

/**
 * Puts an event or meeting on the phone's calendar. It first tries to save it straight into a calendar the person can edit; if the
 * phone has none, or saving fails, it opens the phone's own calendar screen with the details filled in, so it can still be saved there.
 * "opened" means Android opened its calendar editor but cannot confirm a save.
 */
async function createCalendarEvent(item:EventContent|MeetingContent,userId:string,generation:number):Promise<CalendarOutcome> {
  const assertScope=()=>{if(accountScopeGeneration()!==generation)throw new Error("ACCOUNT_CHANGED");};
  assertScope();
  const isMeeting = item.type === "meeting";
  const start = new Date(item.startsAt);
  const end = new Date(isMeeting ? meetingEnd(item) : Date.parse((item as EventContent).endsAt));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime()<start.getTime()) throw new Error("INVALID_DATES");
  if (hasEventEnded(item)) return "past";
  const details = {
    title: item.title,
    startDate: start,
    endDate: end,
    allDay: !isMeeting && Boolean((item as EventContent).allDay),
    location: isMeeting ? "Linqa encrypted call" : (item as EventContent).place,
    notes: item.note,
    // Android will not create an event without a time zone.
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    alarms: item.remind === false || start.getTime() - REMIND_BEFORE_MIN * 60_000 <= Date.now() ? [] : [{ relativeOffset: -REMIND_BEFORE_MIN }],
  };
  try {
    const perm = await Calendar.requestCalendarPermissionsAsync();
    assertScope();
    if (hasEventEnded(item)) return "past";
    if (perm.granted) {
      const primary = await Calendar.getDefaultCalendarAsync().catch(() => null);
      const cal = primary?.allowsModifications ? primary : (await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)).find(x => x.allowsModifications);
      if (cal) {
        assertScope();
        if (hasEventEnded(item)) return "past";
        if (start.getTime() - REMIND_BEFORE_MIN * 60_000 <= Date.now()) details.alarms = [];
        await Calendar.createEventAsync(cal.id, details);
        await rememberAdded(item,userId);
        return "added";
      }
    }
  } catch { /* fall through to the phone's own calendar screen */ }
  assertScope();
  if (hasEventEnded(item)) return "past";
  if (start.getTime() - REMIND_BEFORE_MIN * 60_000 <= Date.now()) details.alarms = [];
  const result = await Calendar.createEventInCalendarAsync(details);
  if (result.action === "saved") { await rememberAdded(item,userId); return "added"; }
  if(result.action==="done")return "opened";
  return "cancelled";
}

export async function scheduleReminder(item: EventContent | MeetingContent, showPreview: boolean): Promise<string | null> {
  const at = Date.parse(item.startsAt) - REMIND_BEFORE_MIN * 60_000;
  if (!Number.isFinite(at) || at <= Date.now() || hasEventEnded(item) || item.remind === false) return null;
  if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("chat-reminders", {name:"Chat reminders", importance:Notifications.AndroidImportance.DEFAULT});
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return null;
  if (at <= Date.now() || hasEventEnded(item)) return null;
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
