// One composer for both events (a time and a place) and meetings (an
// encrypted call in Linqa), plus the cards that appear in the thread.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { ContentMessage, EventContent, MeetingContent, RsvpResponse } from "../../content/types";
import { newId } from "../../content/codec";
import { eventRange, hasEventEnded, joinState, rsvpTally, whenLabel } from "./scheduleModel";
import { addToCalendar, wasAddedToCalendar } from "./calendar";
import { useAccounts } from "../../../../account/AccountContext";
import { addMyEvent, isInMyEvents } from "../../../../services/my-events";
import { Field, ToggleRow } from "../polls/Poll";
import { FormShell, Segmented } from "../../ui/Form";
import { palette as c, space } from "../../ui/tokens";

type Kind = "Meeting" | "Event";
const MEETING_LENGTHS = { "15 min": 15, "30 min": 30, "45 min": 45, "1 hr": 60 } as const;
const EVENT_LENGTHS = { "1 hr": 60, "90 min": 90, "2 hr": 120, "All day": 0 } as const;

export function ScheduleComposer(props: {
  initialKind?: Kind;
  onSend: (content: EventContent | MeetingContent) => Promise<void>;
  onCancel: () => void;
}) {
  const { active } = useAccounts();
  const [kind, setKind] = useState<Kind>(props.initialKind ?? "Meeting");
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => nextHalfHour());
  const [length, setLength] = useState<string>("30 min");
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [remind, setRemind] = useState(true);
  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [busy, setBusy] = useState(false);

  const lengths = kind === "Meeting" ? MEETING_LENGTHS : EVENT_LENGTHS;
  useEffect(() => {
    if (!(length in lengths)) setLength(kind === "Meeting" ? "30 min" : "1 hr");
  }, [kind]);

  const inPast = start.getTime() < Date.now() - 60_000;
  const eventTimes = eventRange(start, (lengths as Record<string, number>)[length] ?? 30);
  const pastEvent = kind === "Event" && eventTimes.end.getTime() <= Date.now();
  const valid = title.trim().length > 0 && (kind === "Event" || !inPast) && (!pastEvent || !!active);

  const send = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const minutes = (lengths as Record<string, number>)[length] ?? 30;
      if (kind === "Meeting") {
        await props.onSend({ type: "meeting", meetingId: newId("m"), title: title.trim(), startsAt: start.toISOString(), durationMin: minutes, note: note.trim() || undefined, remind });
      } else {
        const allDay = minutes === 0;
        const { start: s, end: e } = eventRange(start, minutes);
        const eventId = newId("e");
        if (e.getTime() <= Date.now()) {
          if (!active) return;
          await addMyEvent(active.userId, { id: eventId, kind: "event", title: title.trim(), startsAt: s.toISOString(), endsAt: e.toISOString(), place: place.trim() || undefined, note: note.trim() || undefined });
          props.onCancel();
          return;
        }
        await props.onSend({ type: "event", eventId, title: title.trim(), startsAt: s.toISOString(), endsAt: e.toISOString(), allDay: allDay || undefined, place: place.trim() || undefined, note: note.trim() || undefined, remind: remind && s.getTime() > Date.now() });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell
      title={kind === "Meeting" ? "Schedule a meeting" : "Plan an event"}
      onCancel={props.onCancel}
      cta={busy ? (pastEvent ? "Saving" : "Sending") : pastEvent ? "Save past event" : kind === "Meeting" ? "Send meeting invite" : "Send event"}
      ctaDisabled={!valid || busy}
      onSubmit={send}
      headerExtra={<Segmented options={["Meeting", "Event"]} value={kind} onChange={(v) => setKind(v as Kind)} />}
    >
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="Title">
          <TextInput value={title} onChangeText={setTitle} placeholder={kind === "Meeting" ? "Plan review call" : "Site walkthrough"} maxLength={300} style={styles.input} accessibilityLabel="Title" />
        </Field>
        <View style={styles.two}>
          <PickerField label="Date" value={start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} onPress={() => setPicker("date")} />
          <PickerField label="Starts" value={start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} onPress={() => setPicker("time")} />
        </View>
        {inPast && kind === "Meeting" ? <Text style={styles.error}>Pick a time in the future.</Text> : null}
        {pastEvent ? <Text style={styles.hint}>This event will be saved to Past without sending an invitation or creating a reminder.</Text> : null}
        {picker ? (
          <DateTimePicker
            value={start}
            mode={picker}
            minimumDate={kind === "Meeting" ? new Date() : undefined}
            minuteInterval={5}
            display={Platform.OS === "ios" ? "spinner" : "default"}
            onChange={(e, d) => {
              setPicker(Platform.OS === "ios" ? picker : null);
              if (d && e.type !== "dismissed") setStart(d);
            }}
          />
        ) : null}
        <View style={styles.card}>
          <Text style={styles.label}>Length</Text>
          <Segmented options={Object.keys(lengths)} value={length} onChange={setLength} />
        </View>
        {kind === "Meeting" ? (
          <View style={styles.callNote}>
            <Text style={styles.callTitle}>Encrypted video call in Linqa</Text>
            <Text style={styles.hint}>Join opens 10 minutes before the start. Screen sharing and the whiteboard are available in the call.</Text>
          </View>
        ) : (
          <Field label="Where">
            <TextInput value={place} onChangeText={setPlace} placeholder="Address or place" maxLength={300} style={styles.input} accessibilityLabel="Where" />
          </Field>
        )}
        {!pastEvent ? <View style={styles.card}>
          <ToggleRow label="Remind us both" hint="15 minutes before" value={remind} onChange={setRemind} />
        </View> : null}
        <Field label="Note (optional)">
          <TextInput value={note} onChangeText={setNote} placeholder="Agenda or what to bring" multiline maxLength={2000} style={styles.input} accessibilityLabel="Note" />
        </Field>
      </ScrollView>
    </FormShell>
  );
}

function PickerField({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}, ${value}. Change`} style={[styles.field, { flex: 1 }]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.pickValue}>{value}</Text>
    </Pressable>
  );
}

// --- cards ------------------------------------------------------------------------

export function EventCard(props: {
  event: EventContent;
  messages: ContentMessage[];
  selfId: string;
  nameOf: (id: string) => string;
  outgoing: boolean;
  onRsvp: (r: RsvpResponse) => void;
}) {
  const { event } = props;
  const rsvps = useMemo(() => rsvpTally(event, props.messages), [event, props.messages]);
  const mine = rsvps.get(props.selfId);
  const others = [...rsvps].filter(([id]) => id !== props.selfId);
  const d = new Date(event.startsAt);

  return (
    <View style={[styles.bubble, props.outgoing ? styles.bubbleOut : styles.bubbleIn]}>
      <View style={styles.eventHead}>
        <View style={styles.dateBlock} accessibilityElementsHidden>
          <Text style={styles.dow}>{d.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()}</Text>
          <Text style={styles.dom}>{d.getDate()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Event</Text>
          <Text style={styles.cardTitle}>{event.title}</Text>
          <Text style={styles.hint}>{whenLabel(event.startsAt, event.endsAt, event.allDay)}</Text>
          {event.place ? <Text style={styles.hint}>{event.place}</Text> : null}
        </View>
      </View>
      <View style={styles.rsvpRow} accessibilityRole="radiogroup">
        {(["going", "maybe", "declined"] as RsvpResponse[]).map((r) => (
          <Pressable key={r} onPress={() => props.onRsvp(r)} accessibilityRole="radio" accessibilityState={{ checked: mine === r }} style={[styles.rsvp, mine === r && styles.rsvpOn]}>
            <Text style={[styles.rsvpText, mine === r && { color: c.outgoingInk }]}>{RSVP_LABEL[r]}</Text>
          </Pressable>
        ))}
      </View>
      {others.length ? <Text style={styles.hint}>{others.map(([id, r]) => `${props.nameOf(id)} ${RSVP_PHRASE[r]}`).join(", ")}</Text> : null}
      <CalendarLink item={event} />
    </View>
  );
}

const RSVP_LABEL: Record<RsvpResponse, string> = { going: "Going", maybe: "Maybe", declined: "Can't" };
const RSVP_PHRASE: Record<RsvpResponse, string> = { going: "is going", maybe: "might go", declined: "can't go" };

export function MeetingCard(props: { meeting: MeetingContent; outgoing: boolean; onJoin: () => void }) {
  const { meeting } = props;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const js = joinState(meeting, now);

  return (
    <View style={[styles.bubble, props.outgoing ? styles.bubbleOut : styles.bubbleIn]}>
      <Text style={styles.kicker}>Meeting</Text>
      <Text style={styles.cardTitle}>{meeting.title}</Text>
      <Text style={styles.hint}>
        {whenLabel(meeting.startsAt)}, {meeting.durationMin} min
      </Text>
      {meeting.note ? <Text style={styles.note}>{meeting.note}</Text> : null}
      {js.state === "open" ? (
        <Pressable onPress={props.onJoin} accessibilityRole="button" style={styles.join}>
          <Text style={styles.joinText}>Join call</Text>
        </Pressable>
      ) : (
        <Text style={styles.hint}>
          {js.state === "upcoming" ? (js.opensInMin <= 90 ? `Join opens in ${js.opensInMin} min` : "Join opens 10 minutes before the start") : "This meeting has ended"}
        </Text>
      )}
      <CalendarLink item={meeting} />
    </View>
  );
}

function CalendarLink({ item }: { item: EventContent | MeetingContent }) {
  const {active}=useAccounts();const userId=active?.userId;
  const [added,setAdded]=useState(false);const [onPhone,setOnPhone]=useState(false);const [busy,setBusy]=useState(false);const working=useRef(false);
  const id = item.type === "meeting" ? item.meetingId : item.eventId;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const past = hasEventEnded(item, now);
  // The card remembers across reloads and restarts that it is already in Linqa (Upcoming and the event log) or on the phone's calendar.
  useEffect(() => {
    let live = true;
    setAdded(false);setOnPhone(false);if(userId)void Promise.all([wasAddedToCalendar(item,userId), isInMyEvents(userId,id)]).then(([phone,inLinqa])=>{if(live){setAdded(inLinqa);setOnPhone(phone);}},()=>undefined);
    return () => { live = false; };
  }, [id, item,userId]);
  return (
    <Pressable
      disabled={busy||onPhone||!userId||(past&&added)}
      onPress={async () => {
        if(working.current||!userId)return;working.current=true;setBusy(true);
        try {
        const startsAt = new Date(item.startsAt);
        if (Number.isNaN(startsAt.getTime())) { Alert.alert("Not added", "This event has no valid date, so it cannot be added."); return; }
        const endsAt = item.type === "meeting" ? new Date(startsAt.getTime() + item.durationMin * 60_000) : new Date(item.endsAt);
        // First into Linqa itself (Upcoming on Home and Calls, and the Event log), which needs no permission and works on any phone.
        await addMyEvent(userId,{
          id, kind: item.type, title: item.title, startsAt: startsAt.toISOString(),
          endsAt: (Number.isNaN(endsAt.getTime()) ? startsAt : endsAt).toISOString(),
          ...(item.type === "event" && item.place ? { place: item.place } : {}),
          ...(item.note ? { note: item.note } : {})
        });
        setAdded(true);
        if (hasEventEnded(item)) {
          Alert.alert("Added to past events", "Saved in the Past section of your event log. No calendar alert or reminder was created.");
          return;
        }
        // Then onto the phone's own calendar.
        let problem = "";
        const r = await addToCalendar(item,userId).catch((cause: unknown) => { problem = cause instanceof Error ? cause.message : ""; return "error" as const; });
        if(r==="added")setOnPhone(true);
        if (r === "past") Alert.alert("Added to past events", "Saved in the Past section of your event log. No calendar alert or reminder was created.");
        else if (r === "added") Alert.alert("Added", "It is in Linqa Upcoming and the Event log, and on your calendar.");
        else if(r==="opened")Alert.alert("Added to Linqa","It is in Linqa Upcoming and the Event log. The calendar editor was opened; check your calendar to confirm it was saved.");
        else if (r === "cancelled") Alert.alert("Added to Linqa", "It is in Linqa Upcoming and the Event log. It was not saved to your phone's calendar.");
        else if (r === "denied") Alert.alert("Added to Linqa", "It is in Linqa Upcoming and the Event log. Allow calendar access in Settings to also add it to your phone's calendar.");
        else if (/no activity|resolve|handle|not found/i.test(problem)) Alert.alert("Added to Linqa", "It is in Linqa Upcoming and the Event log. This phone has no calendar app that can save events; install one, such as Google Calendar, to add it there too.");
        else Alert.alert("Added to Linqa", "It is in Linqa Upcoming and the Event log, but it could not be added to your phone's calendar.");
        } catch {Alert.alert("Not added","Your event could not be saved. Please try again.");}
        finally {working.current=false;setBusy(false);}
      }}
      accessibilityRole="button"
      style={styles.calLink}
    >
      <Text style={styles.calText}>{busy?"Adding…":past?(added?"In past events":"Add to past events"):onPhone?"Added to phone calendar":added?"In Linqa · Add to phone calendar":"Add to calendar"}</Text>
    </Pressable>
  );
}

function nextHalfHour(): Date {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
}

const styles = StyleSheet.create({
  form: { padding: space.l, gap: space.m },
  two: { flexDirection: "row", gap: space.s },
  field: { backgroundColor: c.surface, borderRadius: 14, paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.s },
  label: { fontSize: 12, fontWeight: "600", color: c.muted },
  input: { minHeight: 44, fontSize: 16, color: c.ink },
  pickValue: { fontSize: 16, color: c.ink, marginTop: 6 },
  card: { backgroundColor: c.surface, borderRadius: 14, padding: space.l, gap: space.s },
  callNote: { backgroundColor: c.secureTint, borderRadius: 14, padding: space.l, gap: 2 },
  callTitle: { fontSize: 15, fontWeight: "600", color: c.ink },
  hint: { fontSize: 13, lineHeight: 18, color: c.muted },
  error: { color: c.danger, fontSize: 13 },
  bubble: { width: 280, borderRadius: 18, padding: 14, gap: 8, backgroundColor: c.surface },
  bubbleIn: { borderBottomLeftRadius: 6 },
  bubbleOut: { borderBottomRightRadius: 6, borderWidth: 1.5, borderColor: c.outgoing },
  eventHead: { flexDirection: "row", gap: 12 },
  dateBlock: { width: 52, height: 56, borderRadius: 10, backgroundColor: c.outgoing, alignItems: "center", justifyContent: "center" },
  dow: { color: c.outgoingInk, fontSize: 11, fontWeight: "600", letterSpacing: 0.8 },
  dom: { color: c.outgoingInk, fontSize: 22, fontWeight: "600" },
  kicker: { fontSize: 12, fontWeight: "600", color: c.secure },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: c.ink },
  note: { fontSize: 14, color: c.ink },
  rsvpRow: { flexDirection: "row", gap: 6 },
  rsvp: { flex: 1, height: 38, borderRadius: 12, borderWidth: 1.5, borderColor: c.line, alignItems: "center", justifyContent: "center" },
  rsvpOn: { backgroundColor: c.outgoing, borderColor: c.outgoing },
  rsvpText: { fontSize: 13, fontWeight: "600", color: c.ink },
  join: { height: 40, borderRadius: 12, backgroundColor: c.secure, alignItems: "center", justifyContent: "center" },
  joinText: { color: "#fff", fontWeight: "600", fontSize: 15 },
  calLink: { minHeight: 32, justifyContent: "center" },
  calText: { color: c.secure, fontWeight: "600", fontSize: 13 },
});
