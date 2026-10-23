import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, BackHandler, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { DraggableFab } from "../components/workspace/DraggableFab";
import { Banner, Busy, M, ModuleScreen, moduleStyles } from "../components/workspace/module-ui";
import { failureText } from "../components/workspace/kit";
import { clearReminder, eventsWithReminders, setReminder } from "../services/workspace-reminders";
import { useWorkspace } from "../services/use-workspace";
import {
  atTime, dayKey, emptyEvent, eventColor, eventLine, eventProblem, EVENT_COLOR_KEYS, EVENT_COLORS, groupByDay, shiftAnchor, upcoming, viewDays, viewTitle, viewWindow,
  type CalendarEvent, type CalendarView, type EventContent
} from "../services/workspace-model";
import { fonts } from "../theme/tokens";

type Editing = { id: string | null; draft: EventContent; date: Date; start: Date; end: Date; original: string };
type Picking = "date" | "start" | "end" | null;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const UPCOMING_LIMIT = 4;
const snapshot = (e: EventContent, date: Date, start: Date, end: Date) => JSON.stringify([e, dayKey(date), start.getHours() * 60 + start.getMinutes(), end.getHours() * 60 + end.getMinutes()]);
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const nextHour = (on: Date) => { const d = new Date(); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return atTime(on, d.getHours(), 0); };

/**
 * Calendar. An event's title, place, link, description and colour are encrypted on this phone, so the server only holds
 * ciphertext and the start and end time it needs to order things. Events are private to you: inviting other people isn't
 * available yet. The bell sets a private reminder on this phone.
 */
export default function CalendarScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ new?: string }>();
  const ws = useWorkspace();
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(today);
  const [pickedDay, setPickedDay] = useState<Date | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [unreadable, setUnreadable] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [reminders, setReminders] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const run = useRef(0);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/linqa"));
  const days = useMemo(() => viewDays(view, anchor), [view, anchor]);

  const load = useCallback(async () => {
    if (!ws) return;
    const mine = ++run.current;
    setLoading(true); setError("");
    try {
      const result = await ws.events(viewWindow(view, anchor));
      if (mine !== run.current) return;
      setEvents(result.events); setUnreadable(result.unreadable);
    } catch (e) { if (mine === run.current) setError(failureText(e, "load your calendar")); }
    finally { if (mine === run.current) setLoading(false); }
  }, [ws, view, anchor]);
  useEffect(() => { void load(); return () => { run.current++; }; }, [load]);
  useEffect(() => { setEditing(null); }, [ws]);
  useFocusEffect(useCallback(() => { void eventsWithReminders().then(setReminders); }, []));

  const byDay = useMemo(() => new Map(groupByDay(events).map((g) => [g.day, g.events])), [events]);
  const highlight = pickedDay ?? today;
  const matches = useCallback((e: CalendarEvent) => {
    if (colorFilter && eventColor(e) !== colorFilter) return false;
    const q = query.trim().toLowerCase();
    return !q || `${e.title} ${e.location}`.toLowerCase().includes(q);
  }, [query, colorFilter]);
  const listed = useMemo(() => {
    const pool = pickedDay ? (byDay.get(dayKey(pickedDay)) ?? []) : upcoming(events);
    return pool.filter(matches);
  }, [pickedDay, byDay, events, matches]);
  const shown = pickedDay || showAll ? listed : listed.slice(0, UPCOMING_LIMIT);

  function step(by: number) { setAnchor(shiftAnchor(view, anchor, by)); setPickedDay(null); setShowAll(false); }

  function begin(event?: CalendarEvent) {
    setFormError(""); setPicking(null);
    if (event) {
      const start = new Date(event.startsAt), end = new Date(event.endsAt);
      const draft: EventContent = { title: event.title, location: event.location, meetingUrl: event.meetingUrl, timeZone: event.timeZone, description: event.description, color: event.color ?? "blue" };
      setEditing({ id: event.id, draft, date: start, start, end, original: snapshot(draft, start, start, end) });
    } else {
      const day = pickedDay ?? today;
      const start = nextHour(day), end = new Date(+start + 30 * 60_000);
      setEditing({ id: null, draft: emptyEvent(), date: day, start, end, original: snapshot(emptyEvent(), day, start, end) });
    }
  }

  // The Create sheet opens this page with ?new=1: go straight to a blank event, once.
  useEffect(() => {
    if (!params.new || !ws) return;
    begin();
    router.setParams({ new: "" }); // undefined would leave it set, and the same shortcut would then do nothing next time
  }, [params.new, ws]); // eslint-disable-line react-hooks/exhaustive-deps

  const stamps = (e: Editing) => ({ startsAt: atTime(e.date, e.start.getHours(), e.start.getMinutes()), endsAt: atTime(e.date, e.end.getHours(), e.end.getMinutes()) });

  function picked(kind: Exclude<Picking, null>, event: DateTimePickerEvent, value?: Date) {
    if (Platform.OS === "android") setPicking(null);
    if (event.type === "dismissed" || !value || !editing) return;
    if (kind === "date") setEditing({ ...editing, date: value });
    else if (kind === "start") {
      const length = +atTime(editing.date, editing.end.getHours(), editing.end.getMinutes()) - +atTime(editing.date, editing.start.getHours(), editing.start.getMinutes());
      setEditing({ ...editing, start: value, end: new Date(+value + (length > 0 ? length : 30 * 60_000)) }); // keep the length when the start moves
    } else setEditing({ ...editing, end: value });
  }

  async function save() {
    if (!ws || !editing || saving) return;
    const { startsAt, endsAt } = stamps(editing);
    const content: EventContent = { ...editing.draft, title: editing.draft.title.trim(), meetingUrl: editing.draft.meetingUrl.trim() };
    const problem = eventProblem(content, startsAt, endsAt);
    if (problem) { setFormError(problem); return; }
    setSaving(true); setFormError("");
    try {
      if (editing.id) {
        await ws.saveEvent(editing.id, content, startsAt, endsAt);
        // A reminder follows the event if it moves.
        if (reminders.has(editing.id)) { await clearReminder(editing.id); await setReminder(editing.id, startsAt.toISOString()); setReminders(await eventsWithReminders()); }
      } else await ws.createEvent(content, startsAt, endsAt);
      setEditing(null); setPickedDay(startsAt);
      if (startsAt < days[0]! || startsAt >= new Date(days[days.length - 1]!.getTime() + 86_400_000)) setAnchor(startsAt); else await load();
    } catch (e) { setFormError(failureText(e, "save this event")); }
    finally { setSaving(false); }
  }

  function remove() {
    if (!ws || !editing?.id) return;
    const id = editing.id;
    Alert.alert("Delete this event?", "It will be removed from your calendar. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try { await ws.deleteEvent(id); await clearReminder(id); setEvents((list) => list.filter((e) => e.id !== id)); setReminders(await eventsWithReminders()); setEditing(null); }
        catch (e) { setFormError(failureText(e, "delete this event")); }
      } }
    ]);
  }

  async function toggleReminder(e: CalendarEvent) {
    try {
      if (reminders.has(e.id)) { await clearReminder(e.id); }
      else {
        const result = await setReminder(e.id, e.startsAt);
        if (result === "too-soon") Alert.alert("Too soon for a reminder", "This event starts in less than 15 minutes (or has started).");
        if (result === "denied") Alert.alert("Notifications are off", "Allow notifications for Linqa in your phone's Settings to get event reminders.");
      }
    } catch { Alert.alert("Couldn't change the reminder", "Try again."); }
    setReminders(await eventsWithReminders());
  }

  function closeEditor() {
    if (editing && snapshot(editing.draft, editing.date, editing.start, editing.end) !== editing.original) {
      Alert.alert("Discard changes?", "Your edits to this event haven't been saved.", [{ text: "Keep editing", style: "cancel" }, { text: "Discard", style: "destructive", onPress: () => setEditing(null) }]);
    } else setEditing(null);
  }

  // The phone's Back button closes the editor (asking first if there are unsaved changes) rather than leaving the page.
  useEffect(() => {
    if (!editing) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { closeEditor(); return true; });
    return () => sub.remove();
  });

  if (editing) {
    const d = editing.draft;
    const row = (label: string, value: string, kind: Exclude<Picking, null>) => (
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={s.pickRow} onPress={() => setPicking(picking === kind ? null : kind)}>
        <Text style={s.pickLabel}>{label}</Text><Text style={s.pickValue}>{value}</Text>
      </Pressable>
    );
    const picker = (kind: Exclude<Picking, null>, value: Date) => picking === kind ? (
      <DateTimePicker value={value} mode={kind === "date" ? "date" : "time"} themeVariant="dark" display={Platform.OS === "ios" ? "spinner" : "default"} onChange={(e, v) => picked(kind, e, v)} />
    ) : null;
    return (
      <ModuleScreen title={editing.id ? "Edit event" : "New event"} subtitle="Encrypted on this phone before it's saved" onBack={closeEditor}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={s.form} keyboardShouldPersistTaps="handled">
            {formError ? <Banner tone="error">{formError}</Banner> : null}
            <TextInput accessibilityLabel="Title" value={d.title} onChangeText={(v) => setEditing({ ...editing, draft: { ...d, title: v } })} placeholder="Event title" placeholderTextColor={M.faint} maxLength={200} style={s.titleInput} />
            {row("Date", editing.date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", year: "numeric" }), "date")}
            {picker("date", editing.date)}
            {row("Starts", editing.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), "start")}
            {picker("start", editing.start)}
            {row("Ends", editing.end.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), "end")}
            {picker("end", editing.end)}
            <Text style={moduleStyles.label}>Colour</Text>
            <View style={s.swatches}>
              {EVENT_COLOR_KEYS.map((c) => (
                <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Colour ${c}`} accessibilityState={{ selected: (d.color ?? "blue") === c }} onPress={() => setEditing({ ...editing, draft: { ...d, color: c } })}
                  style={[s.swatch, { backgroundColor: EVENT_COLORS[c] }, (d.color ?? "blue") === c && s.swatchOn]} />
              ))}
            </View>
            <TextInput accessibilityLabel="Location" value={d.location} onChangeText={(v) => setEditing({ ...editing, draft: { ...d, location: v } })} placeholder="Location (optional)" placeholderTextColor={M.faint} maxLength={300} style={moduleStyles.input} />
            <TextInput accessibilityLabel="Meeting link" value={d.meetingUrl} onChangeText={(v) => setEditing({ ...editing, draft: { ...d, meetingUrl: v } })} placeholder="Meeting link, https://… (optional)" placeholderTextColor={M.faint} autoCapitalize="none" keyboardType="url" style={moduleStyles.input} />
            <TextInput accessibilityLabel="Description" value={d.description} onChangeText={(v) => setEditing({ ...editing, draft: { ...d, description: v } })} placeholder="Description (optional)" placeholderTextColor={M.faint} multiline textAlignVertical="top" maxLength={10000} style={[moduleStyles.input, { minHeight: 90, paddingTop: 10 }]} />
            <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving }} disabled={saving} style={[moduleStyles.primary, saving && { opacity: 0.6 }]} onPress={() => void save()}>
              <Text style={moduleStyles.primaryText}>{saving ? "Saving…" : "Save event"}</Text>
            </Pressable>
            {editing.id ? <Pressable accessibilityRole="button" onPress={remove} style={moduleStyles.danger}><Ionicons name="trash-outline" size={16} color={M.danger} /><Text style={moduleStyles.dangerText}>Delete event</Text></Pressable> : null}
            <Text style={s.note}>Private to you. Inviting other people isn't available yet.</Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </ModuleScreen>
    );
  }

  const heading = pickedDay ? pickedDay.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }) : "Upcoming Events";
  return (
    <ModuleScreen title="Calendar" subtitle="Manage your time and stay connected" onBack={back}
      actions={[{ icon: "search", label: "Search events", active: searching, onPress: () => { setSearching((v) => !v); if (searching) setQuery(""); } }, { icon: "options-outline", label: "Filter by colour", active: filtering || !!colorFilter, onPress: () => setFiltering((v) => !v) }]}>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {unreadable ? <Banner tone="info">{unreadable === 1 ? "1 event" : `${unreadable} events`} in this view can't be opened on this device. They were saved with a different key.</Banner> : null}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 110 }} keyboardShouldPersistTaps="handled">
        {searching ? (
          <View style={s.search}>
            <Ionicons name="search" size={16} color={M.muted} />
            <TextInput accessibilityLabel="Search events" autoFocus value={query} onChangeText={setQuery} placeholder="Search title or place" placeholderTextColor={M.faint} style={s.searchInput} />
          </View>
        ) : null}
        {filtering ? (
          <View style={s.swatches}>
            <Pressable accessibilityRole="button" accessibilityState={{ selected: !colorFilter }} onPress={() => setColorFilter(null)} style={[s.anyChip, !colorFilter && { borderColor: M.accent }]}><Text style={s.anyText}>All colours</Text></Pressable>
            {EVENT_COLOR_KEYS.map((c) => (
              <Pressable key={c} accessibilityRole="button" accessibilityLabel={`Only ${c} events`} accessibilityState={{ selected: colorFilter === EVENT_COLORS[c] }} onPress={() => setColorFilter(colorFilter === EVENT_COLORS[c] ? null : EVENT_COLORS[c])}
                style={[s.swatch, { backgroundColor: EVENT_COLORS[c] }, colorFilter === EVENT_COLORS[c] && s.swatchOn]} />
            ))}
          </View>
        ) : null}

        <View style={s.controls}>
          <Pressable accessibilityRole="button" accessibilityLabel={view === "month" ? "Previous month" : "Previous week"} hitSlop={6} style={s.step} onPress={() => step(-1)}><Ionicons name="chevron-back" size={20} color={M.text} /></Pressable>
          <Text style={s.monthTitle} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} accessibilityRole="header">{viewTitle(view, anchor)}</Text>
          <View style={s.segment}>
            {(["week", "month"] as const).map((v) => (
              <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: view === v }} onPress={() => { setView(v); setPickedDay(null); setShowAll(false); }} style={[s.segmentItem, view === v && s.segmentOn]}>
                <Text style={[s.segmentText, view === v && { color: M.text, fontFamily: fonts.bold }]}>{v === "week" ? "Week" : "Month"}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={view === "month" ? "Next month" : "Next week"} hitSlop={6} style={s.step} onPress={() => step(1)}><Ionicons name="chevron-forward" size={20} color={M.text} /></Pressable>
        </View>

        <View style={s.gridCard}>
          <View style={s.grid}>
            {WEEKDAYS.map((w) => <Text key={w} style={s.weekday}>{w}</Text>)}
            {days.map((day) => {
              const key = dayKey(day), on = key === dayKey(highlight), isToday = key === dayKey(today);
              const outside = view === "month" && day.getMonth() !== anchor.getMonth();
              const colors = [...new Set((byDay.get(key) ?? []).map(eventColor))].slice(0, 3);
              return (
                <Pressable key={key} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${day.toLocaleDateString([], { month: "long", day: "numeric" })}${byDay.has(key) ? `, ${byDay.get(key)!.length} events` : ""}`}
                  style={s.cell} onPress={() => { if (outside) setAnchor(day); setPickedDay(pickedDay && dayKey(pickedDay) === key ? null : day); setShowAll(false); }}>
                  <View style={[s.day, on && s.dayOn, !on && isToday && s.dayToday]}>
                    <Text style={[s.dayText, outside && { color: M.faint }, on && { color: M.text, fontFamily: fonts.bold }]}>{day.getDate()}</Text>
                  </View>
                  <View style={s.dots}>{colors.map((c) => <View key={c} style={[s.dot, { backgroundColor: c }]} />)}</View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={s.listHead}>
          <Text style={s.listTitle}>{heading}</Text>
          {pickedDay ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setPickedDay(null)}><Text style={s.link}>Show upcoming</Text></Pressable>
          ) : listed.length > UPCOMING_LIMIT ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setShowAll((v) => !v)}><Text style={s.link}>{showAll ? "Show less" : "View All"} ›</Text></Pressable>
          ) : null}
        </View>
        {loading && !events.length ? <Busy /> : !shown.length ? (
          <Text style={s.none}>{query || colorFilter ? "No events match." : pickedDay ? "Nothing scheduled." : "Nothing upcoming in this view."}</Text>
        ) : shown.map((e) => {
          const line = eventLine(e);
          const color = eventColor(e);
          return (
            <Pressable key={e.id} accessibilityRole="button" accessibilityLabel={`${e.title}, ${clock(e.startsAt)}`} style={s.event} onPress={() => begin(e)}>
              <View style={[s.eventDot, { backgroundColor: color }]} />
              <View style={s.times}><Text style={s.timeStart}>{clock(e.startsAt)}</Text><Text style={s.timeEnd}>{clock(e.endsAt)}</Text></View>
              <View style={s.rule} />
              <View style={{ flex: 1 }}>
                <Text style={s.eventTitle} numberOfLines={1}>{e.title}</Text>
                {line.kind !== "none" ? (
                  <View style={s.lineRow}>
                    <Ionicons name={line.kind === "video" ? "videocam-outline" : "location-outline"} size={15} color={color} />
                    <Text style={s.eventMeta} numberOfLines={1}>{line.text}</Text>
                  </View>
                ) : null}
              </View>
              {line.kind === "video" ? <Pressable accessibilityRole="button" accessibilityLabel="Join meeting" hitSlop={6} style={s.join} onPress={() => void Linking.openURL(e.meetingUrl.trim())}><Text style={s.joinText}>Join</Text></Pressable> : null}
              <Pressable accessibilityRole="button" accessibilityLabel={reminders.has(e.id) ? "Remove reminder" : "Remind me 15 minutes before"} accessibilityState={{ selected: reminders.has(e.id) }} hitSlop={6} onPress={() => void toggleReminder(e)} style={[s.bell, reminders.has(e.id) && { backgroundColor: M.accent }]}>
                <Ionicons name={reminders.has(e.id) ? "notifications" : "notifications-outline"} size={19} color={reminders.has(e.id) ? M.text : M.accent} />
              </Pressable>
            </Pressable>
          );
        })}
      </ScrollView>
      <DraggableFab label="New Event" icon="add" storageKey="calendar" zoomOnFocus onPress={() => begin()} />
    </ModuleScreen>
  );
}

const s = StyleSheet.create({
  form: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  titleInput: { fontFamily: fonts.bold, fontSize: 20, color: M.text, borderBottomWidth: 1, borderBottomColor: M.border, paddingVertical: 8 },
  pickRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 14, paddingHorizontal: 14, minHeight: 48 },
  pickLabel: { fontFamily: fonts.medium, fontSize: 13, color: M.muted },
  pickValue: { fontFamily: fonts.semibold, fontSize: 14, color: M.text },
  swatches: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: "transparent" },
  swatchOn: { borderColor: M.text, transform: [{ scale: 1.12 }] },
  anyChip: { borderWidth: 1, borderColor: M.border, borderRadius: 999, paddingHorizontal: 12, minHeight: 32, justifyContent: "center", backgroundColor: M.card },
  anyText: { fontFamily: fonts.medium, fontSize: 12.5, color: M.text },
  note: { fontFamily: fonts.regular, fontSize: 12, color: M.muted, textAlign: "center", marginTop: 4 },
  search: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, minHeight: 42, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 14, marginBottom: 10 },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: M.text, paddingVertical: 6 },
  controls: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  step: { width: 36, height: 40, borderRadius: 12, borderWidth: 1, borderColor: M.border, backgroundColor: M.card, alignItems: "center", justifyContent: "center" },
  monthTitle: { flex: 1, fontFamily: fonts.extrabold, fontSize: 19, color: M.text },
  segment: { flexDirection: "row", borderWidth: 1, borderColor: M.border, borderRadius: 14, backgroundColor: M.card, padding: 3 },
  segmentItem: { paddingHorizontal: 9, minHeight: 32, borderRadius: 11, justifyContent: "center" },
  segmentOn: { backgroundColor: M.accent },
  segmentText: { fontFamily: fonts.medium, fontSize: 13, color: M.muted },
  gridCard: { backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 18, padding: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  weekday: { width: "14.2857%", textAlign: "center", fontFamily: fonts.medium, fontSize: 12, color: M.muted, paddingVertical: 8 },
  cell: { width: "14.2857%", alignItems: "center", paddingVertical: 3, minHeight: 52 },
  day: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  dayOn: { backgroundColor: M.accent },
  dayToday: { borderWidth: 1, borderColor: M.accent },
  dayText: { fontFamily: fonts.semibold, fontSize: 15, color: M.text },
  dots: { flexDirection: "row", gap: 3, height: 6, marginTop: 2 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  listHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 10 },
  listTitle: { fontFamily: fonts.extrabold, fontSize: 19, color: M.text },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: M.accent },
  none: { fontFamily: fonts.regular, fontSize: 13, color: M.muted, marginTop: 4 },
  event: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: M.card, borderWidth: 1, borderColor: M.border, borderRadius: 16, padding: 12, marginBottom: 10 },
  eventDot: { width: 12, height: 12, borderRadius: 6 },
  times: { width: 64 },
  timeStart: { fontFamily: fonts.semibold, fontSize: 13, color: M.text },
  timeEnd: { fontFamily: fonts.regular, fontSize: 12.5, color: M.muted, marginTop: 2 },
  rule: { width: 1, alignSelf: "stretch", backgroundColor: M.border },
  eventTitle: { fontFamily: fonts.bold, fontSize: 16, color: M.text },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  eventMeta: { flexShrink: 1, fontFamily: fonts.regular, fontSize: 13, color: M.muted },
  join: { backgroundColor: M.accent, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  joinText: { fontFamily: fonts.bold, fontSize: 12, color: M.text },
  bell: { width: 40, height: 40, borderRadius: 12, backgroundColor: "#0D3050", alignItems: "center", justifyContent: "center" }
});
