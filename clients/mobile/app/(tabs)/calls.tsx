import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import {
  CallNotPermittedError,
  CallsService,
  NoActiveDeviceError,
  avatarTint,
  callDateBucket,
  formatCallDuration,
  formatScheduledFor,
  formatTalkTime,
  schedulePresets,
  type CallHistoryItem,
  type CallType,
  type ScheduledCall
} from "../../services/calls.service";
import { MobileHubService, type HubContact } from "../../services/mobile-hub.service";
import { accessTokenProvider } from "../../services/session";
import { QuickCreateSheet } from "../../components/QuickCreateSheet";
import { createActionsForPath, type CreateActionKey } from "../../navigation/information-architecture";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080";

const FILTERS = ["All", "Missed", "Audio", "Video"] as const;
type Filter = (typeof FILTERS)[number];

/** What the contact picker is being opened for. */
type PickerIntent = { mode: "call"; callType: CallType } | { mode: "schedule" };

export default function CallsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const service = useMemo(
    () => new CallsService(API, () => accessTokenProvider.getAccessToken()),
    []
  );
  const hub = useMemo(
    () => new MobileHubService(API, () => accessTokenProvider.getAccessToken()),
    []
  );

  const [calls, setCalls] = useState<CallHistoryItem[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledCall[]>([]);
  const [contacts, setContacts] = useState<HubContact[]>([]);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false);
  const [picker, setPicker] = useState<PickerIntent | null>(null);
  const [scheduleFor, setScheduleFor] = useState<{ contact: HubContact; presetKey: string } | null>(null);

  const load = useCallback(
    async (mode: "initial" | "refresh" = "initial") => {
      if (mode === "refresh") setRefreshing(true);
      else setLoading(true);
      setError(null);

      // Independent surfaces: a failing scheduled-call read must not blank the
      // call log, and neither should block the contact list used for placing a
      // call. The previous version swallowed every failure into console.warn,
      // so a signed-out session looked identical to "you have no calls".
      const [historyResult, scheduledResult, hubResult] = await Promise.allSettled([
        service.listHistory(),
        service.listScheduled(),
        hub.loadHub()
      ]);

      if (historyResult.status === "fulfilled") setCalls(historyResult.value);
      if (scheduledResult.status === "fulfilled") setScheduled(scheduledResult.value);
      if (hubResult.status === "fulfilled") setContacts(hubResult.value.contacts);

      if (historyResult.status === "rejected") {
        setError(
          historyResult.reason instanceof Error
            ? historyResult.reason.message
            : "Unable to load your call history."
        );
      }

      setLoading(false);
      setRefreshing(false);
    },
    [service, hub]
  );

  useEffect(() => {
    void load("initial");
  }, [load]);

  const counts = useMemo(
    () => ({
      All: calls.length,
      Missed: calls.filter((call) => call.status === "MISSED").length,
      Audio: calls.filter((call) => call.callType === "AUDIO").length,
      Video: calls.filter((call) => call.callType === "VIDEO").length
    }),
    [calls]
  );

  const talkSeconds = useMemo(
    () => calls.reduce((total, call) => total + (call.status === "COMPLETED" ? call.durationSeconds : 0), 0),
    [calls]
  );

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const visible = calls.filter((call) => {
      const matchesText = !needle || call.peerDisplayName.toLowerCase().includes(needle);
      const matchesFilter =
        filter === "All" ||
        (filter === "Missed" && call.status === "MISSED") ||
        (filter === "Audio" && call.callType === "AUDIO") ||
        (filter === "Video" && call.callType === "VIDEO");
      return matchesText && matchesFilter;
    });

    // Date buckets in chronological order of first appearance; the list is
    // already newest-first from the server.
    const order: string[] = [];
    const buckets = new Map<string, CallHistoryItem[]>();
    for (const call of visible) {
      const bucket = callDateBucket(call.createdAt);
      if (!buckets.has(bucket)) {
        buckets.set(bucket, []);
        order.push(bucket);
      }
      buckets.get(bucket)!.push(call);
    }
    return order.map((title) => ({ title, data: buckets.get(title)! }));
  }, [calls, filter, query]);

  const callableContacts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return contacts.filter((contact) => !needle || contact.displayName.toLowerCase().includes(needle));
  }, [contacts, query]);

  function reportFailure(cause: unknown, fallback: string) {
    if (cause instanceof NoActiveDeviceError || cause instanceof CallNotPermittedError) {
      setError(cause.message);
      return;
    }
    setError(cause instanceof Error ? cause.message : fallback);
  }

  async function placeCall(contact: HubContact, callType: CallType) {
    setPicker(null);
    setBusy(`Calling ${contact.displayName}…`);
    setError(null);
    setNotice(null);
    try {
      await service.placeCall({ recipientUserId: contact.id, callType });
      setNotice(
        `${callType === "VIDEO" ? "Video call" : "Call"} to ${contact.displayName} started — relay-only.`
      );
      await load("refresh");
    } catch (cause) {
      reportFailure(cause, `Unable to call ${contact.displayName}.`);
    } finally {
      setBusy(null);
    }
  }

  async function confirmSchedule() {
    if (!scheduleFor) return;
    const preset = schedulePresets().find((item) => item.key === scheduleFor.presetKey);
    if (!preset) return;

    setBusy("Scheduling call…");
    setError(null);
    setNotice(null);
    try {
      await service.schedule({
        participantUserIds: [scheduleFor.contact.id],
        callType: "AUDIO",
        privacyMode: "RELAY_ONLY",
        scheduledFor: preset.at.toISOString()
      });
      setScheduleFor(null);
      setNotice(`Call with ${scheduleFor.contact.displayName} scheduled for ${preset.label.toLowerCase()}.`);
      await load("refresh");
      setScheduleSheetOpen(true);
    } catch (cause) {
      reportFailure(cause, "Unable to schedule that call.");
    } finally {
      setBusy(null);
    }
  }

  async function joinScheduled(item: ScheduledCall) {
    setBusy("Joining call…");
    setError(null);
    setNotice(null);
    try {
      const joined = await service.joinScheduledCall(item.id);
      setScheduleSheetOpen(false);
      setNotice(
        `${joined.callType === "VIDEO" ? "Video" : "Audio"} call ready — join window is active until ${new Date(joined.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`
      );
      router.push("/(tabs)/calls" as never);
    } catch (cause) {
      reportFailure(cause, "Unable to join that scheduled call.");
    } finally {
      setBusy(null);
    }
  }

  async function cancelScheduled(item: ScheduledCall) {
    setBusy("Cancelling…");
    setError(null);
    try {
      await service.cancelScheduled(item.id);
      setNotice("Scheduled call cancelled.");
      await load("refresh");
    } catch (cause) {
      reportFailure(cause, "Unable to cancel that scheduled call.");
    } finally {
      setBusy(null);
    }
  }

  const quickActions = createActionsForPath("/calls");

  function onQuickCreateAction(key: CreateActionKey) {
    setQuickCreateOpen(false);
    // Handled in place rather than navigated: every one of these is an action
    // on this screen, and the old routes pointed back at this same tab.
    if (key === "call") setPicker({ mode: "call", callType: "AUDIO" });
    else if (key === "video") setPicker({ mode: "call", callType: "VIDEO" });
    else if (key === "schedule") setPicker({ mode: "schedule" });
    else {
      const selected = quickActions.find((item) => item.key === key);
      if (selected) router.push(selected.route as never);
    }
  }

  const nextScheduled = scheduled[0];

  return (
    <SafeAreaView edges={["left", "right"]} style={styles.screen}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>PRIVATE CALLING</Text>
          <Text style={styles.title}>Calls</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.iconButton}
            onPress={() => setQuickCreateOpen(true)}
            accessibilityRole="button"
            accessibilityLabel="New call options"
          >
            <Ionicons name="add" size={22} color="#A9BDD0" />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => setScheduleSheetOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              scheduled.length
                ? `Scheduled calls, ${scheduled.length} upcoming`
                : "Scheduled calls"
            }
          >
            <Ionicons name="calendar-outline" size={20} color="#A9BDD0" />
            {scheduled.length > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{scheduled.length > 9 ? "9+" : scheduled.length}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable
            style={[styles.iconButton, styles.primaryButton]}
            onPress={() => setPicker({ mode: "call", callType: "AUDIO" })}
            accessibilityRole="button"
            accessibilityLabel="Start a new call"
          >
            <Ionicons name="call" size={21} color="#001B24" />
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        stickyHeaderIndices={[]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load("refresh")}
            tintColor="#12D6AE"
            colors={["#12D6AE"]}
          />
        }
      >
        <View style={styles.statRow}>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, counts.Missed > 0 && styles.statValueAlert]}>{counts.Missed}</Text>
            <Text style={styles.statLabel}>Missed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{counts.All}</Text>
            <Text style={styles.statLabel}>Total calls</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{formatTalkTime(talkSeconds)}</Text>
            <Text style={styles.statLabel}>Talk time</Text>
          </View>
        </View>

        {nextScheduled ? (
          <Pressable style={styles.upcomingCard} onPress={() => setScheduleSheetOpen(true)}>
            <View style={styles.upcomingIcon}>
              <Ionicons
                name={nextScheduled.callType === "VIDEO" ? "videocam" : "time"}
                size={18}
                color="#12D6AE"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.upcomingLabel}>NEXT SCHEDULED</Text>
              <Text style={styles.upcomingTitle} numberOfLines={1}>
                {formatScheduledFor(nextScheduled.scheduledFor)} ·{" "}
                {nextScheduled.participantNames[0] ?? `${nextScheduled.participantCount} invited`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="#6E879B" />
          </Pressable>
        ) : null}

        {/* Privacy Center, not /settings/privacy — the latter does not exist
            as a route, and this card previously had no handler at all. */}
        <Pressable
          style={styles.securityCard}
          onPress={() => router.push("/privacy-center" as never)}
          accessibilityRole="button"
        >
          <View style={styles.securityIcon}>
            <Ionicons name="shield-checkmark" size={20} color="#12D6AE" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.securityTitle}>Private calling mode</Text>
            <Text style={styles.securityCopy}>
              Calls you place here are relay-only, which hides peer IP addresses.
            </Text>
          </View>
          <Text style={styles.manage}>Manage</Text>
        </Pressable>

        <View style={styles.search}>
          <Ionicons name="search" size={18} color="#6E879B" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search calls and contacts"
            placeholderTextColor="#6E879B"
            style={styles.searchInput}
            returnKeyType="search"
          />
          {query ? (
            <Pressable onPress={() => setQuery("")} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={18} color="#6E879B" />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.filters}>
          {FILTERS.map((item) => (
            <Pressable
              key={item}
              onPress={() => setFilter(item)}
              style={[styles.chip, filter === item && styles.chipActive]}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, filter === item && styles.chipTextActive]}>
                {item}
                {counts[item] > 0 ? ` ${counts[item]}` : ""}
              </Text>
            </Pressable>
          ))}
        </View>

        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#12D6AE" size="small" />
            <Text style={styles.busyText}>{busy}</Text>
          </View>
        ) : null}

        {notice ? (
          <Pressable style={styles.noticeRow} onPress={() => setNotice(null)}>
            <Ionicons name="checkmark-circle" size={16} color="#12D6AE" />
            <Text style={styles.noticeText}>{notice}</Text>
          </Pressable>
        ) : null}

        {error ? (
          <Pressable style={styles.errorRow} onPress={() => void load("refresh")}>
            <Ionicons name="alert-circle" size={16} color="#FF8B97" />
            <Text style={styles.errorText}>{error} Tap to retry.</Text>
          </Pressable>
        ) : null}

        {loading ? (
          <View style={styles.loadingBlock}>
            <ActivityIndicator color="#12D6AE" />
            <Text style={styles.loadingText}>Loading calls…</Text>
          </View>
        ) : sections.length === 0 ? (
          <View style={styles.empty}>
            <View style={styles.emptyIcon}>
              <Ionicons name="call-outline" size={34} color="#4D8BFF" />
            </View>
            <Text style={styles.emptyTitle}>
              {calls.length === 0 ? "No calls yet" : "No calls match"}
            </Text>
            <Text style={styles.emptyCopy}>
              {calls.length === 0
                ? "Place your first encrypted call — every call from here is relay-only."
                : "Try a different filter or clear your search."}
            </Text>
            {calls.length === 0 ? (
              <Pressable
                style={styles.emptyCta}
                onPress={() => setPicker({ mode: "call", callType: "AUDIO" })}
              >
                <Ionicons name="call" size={16} color="#001B24" />
                <Text style={styles.emptyCtaText}>Start a call</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            scrollEnabled={false}
            contentContainerStyle={styles.list}
            renderSectionHeader={({ section }) => (
              <Text style={styles.sectionHeader}>{section.title.toUpperCase()}</Text>
            )}
            renderItem={({ item }) => {
              const missed = item.status === "MISSED";
              const duration = formatCallDuration(item.durationSeconds);
              const time = new Date(item.createdAt).toLocaleTimeString(undefined, {
                hour: "numeric",
                minute: "2-digit"
              });
              return (
                <View style={styles.callRow}>
                  <View style={[styles.avatar, { backgroundColor: avatarTint(item.peerDisplayName) }]}>
                    <Text style={styles.avatarText}>{initials(item.peerDisplayName)}</Text>
                  </View>

                  <View style={styles.callInfo}>
                    <Text style={[styles.callName, missed && styles.missedName]} numberOfLines={1}>
                      {item.peerDisplayName}
                    </Text>
                    <View style={styles.metaLine}>
                      <Ionicons
                        name={
                          missed
                            ? "arrow-down"
                            : item.direction === "INCOMING"
                              ? "arrow-down"
                              : "arrow-up"
                        }
                        size={13}
                        color={missed ? "#FF6B7A" : "#7D95A8"}
                      />
                      <Text style={[styles.callMeta, missed && styles.missed]} numberOfLines={1}>
                        {missed ? "Missed" : item.direction === "INCOMING" ? "Incoming" : "Outgoing"}
                        {` · ${time}`}
                        {duration ? ` · ${duration}` : ""}
                      </Text>
                    </View>
                  </View>

                  {/* Both call types on every row: the old single button used
                      the historical call's type, so there was no way to return
                      a video call with audio (or the reverse) — and it had no
                      onPress at all. */}
                  <Pressable
                    style={styles.rowAction}
                    onPress={() => void placeCall(peerAsContact(item), "AUDIO")}
                    accessibilityRole="button"
                    accessibilityLabel={`Call ${item.peerDisplayName}`}
                  >
                    <Ionicons name="call" size={18} color="#12D6AE" />
                  </Pressable>
                  <Pressable
                    style={[styles.rowAction, styles.rowActionSpaced]}
                    onPress={() => void placeCall(peerAsContact(item), "VIDEO")}
                    accessibilityRole="button"
                    accessibilityLabel={`Video call ${item.peerDisplayName}`}
                  >
                    <Ionicons name="videocam" size={18} color="#7FB6FF" />
                  </Pressable>
                </View>
              );
            }}
          />
        )}
      </ScrollView>

      <QuickCreateSheet
        visible={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        actions={quickActions}
        onAction={onQuickCreateAction}
        contextLabel="Start or schedule a private call"
      />

      {/* Contact picker — backs the [call] button, the [+] audio/video
          actions, and the schedule flow. */}
      <Modal
        transparent
        visible={picker !== null}
        animationType="slide"
        onRequestClose={() => setPicker(null)}
      >
        <View style={[styles.sheetBackdrop, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>
                  {picker?.mode === "schedule"
                    ? "Schedule a call"
                    : picker?.callType === "VIDEO"
                      ? "New video call"
                      : "New call"}
                </Text>
                <Text style={styles.sheetSubtitle}>
                  {picker?.mode === "schedule"
                    ? "Pick who to meet, then when."
                    : "Relay-only. Pick a contact to ring."}
                </Text>
              </View>
              <Pressable style={styles.sheetClose} onPress={() => setPicker(null)}>
                <Ionicons name="close" size={20} color="#A8BDC9" />
              </Pressable>
            </View>

            <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {callableContacts.length === 0 ? (
                <View style={styles.sheetEmpty}>
                  <Ionicons name="people-outline" size={28} color="#6E879B" />
                  <Text style={styles.sheetEmptyText}>
                    No contacts are available yet. Start a conversation first — you can call anyone you
                    share a chat with.
                  </Text>
                  <Pressable
                    style={styles.sheetEmptyCta}
                    onPress={() => {
                      setPicker(null);
                      router.push("/(tabs)/chats" as never);
                    }}
                  >
                    <Text style={styles.sheetEmptyCtaText}>Open chats</Text>
                  </Pressable>
                </View>
              ) : (
                callableContacts.map((contact) => (
                  <Pressable
                    key={contact.id}
                    style={styles.contactRow}
                    onPress={() => {
                      if (picker?.mode === "schedule") {
                        setPicker(null);
                        setScheduleFor({ contact, presetKey: schedulePresets()[0]!.key });
                      } else {
                        void placeCall(contact, picker?.callType ?? "AUDIO");
                      }
                    }}
                    accessibilityRole="button"
                  >
                    <View style={[styles.avatar, { backgroundColor: avatarTint(contact.displayName) }]}>
                      <Text style={styles.avatarText}>{initials(contact.displayName)}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.contactName} numberOfLines={1}>{contact.displayName}</Text>
                      <Text style={styles.contactMeta}>
                        {contact.online ? "Online now" : contact.statusBody || "Offline"}
                      </Text>
                    </View>
                    {contact.online ? <View style={styles.onlineDot} /> : null}
                    <Ionicons
                      name={
                        picker?.mode === "schedule"
                          ? "calendar-outline"
                          : picker?.callType === "VIDEO"
                            ? "videocam"
                            : "call"
                      }
                      size={19}
                      color="#12D6AE"
                    />
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Time picker for the schedule flow. Preset offsets rather than a
          date-picker dependency the app does not carry. */}
      <Modal
        transparent
        visible={scheduleFor !== null}
        animationType="fade"
        onRequestClose={() => setScheduleFor(null)}
      >
        <View style={[styles.sheetBackdrop, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>When?</Text>
                <Text style={styles.sheetSubtitle}>
                  Call with {scheduleFor?.contact.displayName ?? ""}
                </Text>
              </View>
              <Pressable style={styles.sheetClose} onPress={() => setScheduleFor(null)}>
                <Ionicons name="close" size={20} color="#A8BDC9" />
              </Pressable>
            </View>

            <View style={styles.presetWrap}>
              {schedulePresets().map((preset) => {
                const selected = scheduleFor?.presetKey === preset.key;
                return (
                  <Pressable
                    key={preset.key}
                    style={[styles.preset, selected && styles.presetActive]}
                    onPress={() =>
                      setScheduleFor((current) =>
                        current ? { ...current, presetKey: preset.key } : current
                      )
                    }
                    accessibilityRole="button"
                  >
                    <Text style={[styles.presetText, selected && styles.presetTextActive]}>
                      {preset.label}
                    </Text>
                    <Text style={styles.presetTime}>
                      {preset.at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable style={styles.confirmButton} onPress={() => void confirmSchedule()}>
              <Ionicons name="calendar" size={17} color="#001B24" />
              <Text style={styles.confirmButtonText}>Schedule relay-only call</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Scheduled calls — backs the [calendar] button. */}
      <Modal
        transparent
        visible={scheduleSheetOpen}
        animationType="slide"
        onRequestClose={() => setScheduleSheetOpen(false)}
      >
        <View style={[styles.sheetBackdrop, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Scheduled calls</Text>
                <Text style={styles.sheetSubtitle}>
                  {scheduled.length
                    ? `${scheduled.length} upcoming`
                    : "Nothing scheduled yet"}
                </Text>
              </View>
              <Pressable style={styles.sheetClose} onPress={() => setScheduleSheetOpen(false)}>
                <Ionicons name="close" size={20} color="#A8BDC9" />
              </Pressable>
            </View>

            <ScrollView style={styles.sheetScroll}>
              {scheduled.length === 0 ? (
                <View style={styles.sheetEmpty}>
                  <Ionicons name="calendar-outline" size={28} color="#6E879B" />
                  <Text style={styles.sheetEmptyText}>
                    Schedule a call and it will appear here, with a reminder on the Calls tab.
                  </Text>
                </View>
              ) : (
                scheduled.map((item) => (
                  <View key={item.id} style={styles.scheduledRow}>
                    <View style={styles.scheduledIcon}>
                      <Ionicons
                        name={item.callType === "VIDEO" ? "videocam" : "call"}
                        size={17}
                        color="#12D6AE"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.scheduledWhen}>{formatScheduledFor(item.scheduledFor)}</Text>
                      <Text style={styles.scheduledWho} numberOfLines={1}>
                        {item.isOrganizer
                          ? item.participantNames.join(", ") || `${item.participantCount} invited`
                          : `Organized by ${item.organizerName}`}
                      </Text>
                      <Text style={styles.scheduledMeta}>
                        {item.callType === "VIDEO" ? "Video" : "Audio"}
                        {item.privacyMode === "RELAY_ONLY" ? " · Relay-only" : " · Standard"}
                      </Text>
                    </View>
                    <Pressable
                      style={[
                        styles.cancelButton,
                        !item.isOrganizer && { backgroundColor: "#0B2E32", borderColor: "#0B8175" }
                      ]}
                      onPress={() => void (item.isOrganizer ? cancelScheduled(item) : joinScheduled(item))}
                      accessibilityRole="button"
                      accessibilityLabel={item.isOrganizer ? "Cancel scheduled call" : "Join scheduled call"}
                    >
                      <Text style={[styles.cancelButtonText, !item.isOrganizer && { color: "#8AE9D8" }]}>
                        {item.isOrganizer ? "Cancel" : "Join"}
                      </Text>
                    </Pressable>
                  </View>
                ))
              )}
            </ScrollView>

            <Pressable
              style={styles.confirmButton}
              onPress={() => {
                setScheduleSheetOpen(false);
                setPicker({ mode: "schedule" });
              }}
            >
              <Ionicons name="add" size={18} color="#001B24" />
              <Text style={styles.confirmButtonText}>Schedule a call</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase();
}

/**
 * A history row already carries the peer's user id and name, which is all
 * `placeCall` needs — so calling back does not require a contact lookup.
 */
function peerAsContact(item: CallHistoryItem): HubContact {
  return {
    id: item.peerUserId,
    displayName: item.peerDisplayName,
    initials: initials(item.peerDisplayName),
    colorHue: 0,
    online: false,
    statusBody: null
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#001520", paddingHorizontal: 16 },
  header: {
    marginTop: 12, marginBottom: 14, flexDirection: "row",
    justifyContent: "space-between", alignItems: "center"
  },
  eyebrow: { color: "#12D6AE", fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: "#F7FBFF", fontSize: 31, fontWeight: "800", marginTop: 3 },
  headerActions: { flexDirection: "row", gap: 10 },
  iconButton: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: "#082739",
    borderWidth: 1, borderColor: "#17445A", alignItems: "center", justifyContent: "center"
  },
  primaryButton: { backgroundColor: "#12D6AE", borderColor: "#12D6AE" },
  badge: {
    position: "absolute", top: -4, right: -4, minWidth: 18, height: 18, borderRadius: 9,
    backgroundColor: "#12D6AE", alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4, borderWidth: 2, borderColor: "#001520"
  },
  badgeText: { color: "#001B24", fontSize: 9, fontWeight: "900" },

  statRow: { flexDirection: "row", gap: 10 },
  statCard: {
    flex: 1, backgroundColor: "#082536", borderRadius: 14, borderWidth: 1,
    borderColor: "#17445A", paddingVertical: 12, alignItems: "center"
  },
  statValue: { color: "#F3FAFF", fontSize: 20, fontWeight: "800" },
  statValueAlert: { color: "#FF6B7A" },
  statLabel: { color: "#7892A6", fontSize: 10.5, fontWeight: "700", marginTop: 3, letterSpacing: 0.3 },

  upcomingCard: {
    marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#06263A", borderRadius: 16, borderWidth: 1,
    borderColor: "#1B5E5A", padding: 13
  },
  upcomingIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: "#073B3C",
    alignItems: "center", justifyContent: "center"
  },
  upcomingLabel: { color: "#12D6AE", fontSize: 9.5, fontWeight: "900", letterSpacing: 1 },
  upcomingTitle: { color: "#EDF8FF", fontSize: 13.5, fontWeight: "700", marginTop: 3 },

  securityCard: {
    marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: "#082739", borderRadius: 16, borderWidth: 1,
    borderColor: "#17445A", padding: 14
  },
  securityIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: "#073B3C",
    alignItems: "center", justifyContent: "center"
  },
  securityTitle: { color: "#EDF8FF", fontWeight: "800", fontSize: 14 },
  securityCopy: { color: "#7F98AB", fontSize: 12, marginTop: 2, lineHeight: 16 },
  manage: { color: "#12D6AE", fontWeight: "800", fontSize: 12 },

  search: {
    height: 48, borderRadius: 14, backgroundColor: "#072536", borderWidth: 1,
    borderColor: "#17445A", marginTop: 14, paddingHorizontal: 14,
    flexDirection: "row", alignItems: "center", gap: 10
  },
  searchInput: { flex: 1, color: "#F4FAFF", fontSize: 15 },

  filters: { flexDirection: "row", gap: 8, marginVertical: 14 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: "#082536" },
  chipActive: { backgroundColor: "#0A4D4A", borderWidth: 1, borderColor: "#12D6AE" },
  chipText: { color: "#7892A6", fontSize: 12, fontWeight: "700" },
  chipTextActive: { color: "#12D6AE" },

  busyRow: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 4, marginBottom: 8 },
  busyText: { color: "#9FB6C6", fontSize: 12.5, fontWeight: "600" },
  noticeRow: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#06302C",
    borderWidth: 1, borderColor: "#12D6AE", borderRadius: 12, padding: 10, marginBottom: 10
  },
  noticeText: { color: "#8FE9D6", fontSize: 12, flex: 1 },
  errorRow: {
    flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#2A1620",
    borderWidth: 1, borderColor: "#7A2B3A", borderRadius: 12, padding: 10, marginBottom: 10
  },
  errorText: { color: "#FF8B97", fontSize: 12, flex: 1 },

  loadingBlock: { alignItems: "center", paddingTop: 60, gap: 10 },
  loadingText: { color: "#7D95A8", fontSize: 12.5 },

  list: { paddingBottom: 8 },
  sectionHeader: {
    color: "#5E7C90", fontSize: 10.5, fontWeight: "900", letterSpacing: 1.1,
    marginTop: 6, marginBottom: 8
  },
  callRow: {
    minHeight: 74, backgroundColor: "#082536", borderWidth: 1,
    borderColor: "#17445A", borderRadius: 16, padding: 12, marginBottom: 10,
    flexDirection: "row", alignItems: "center"
  },
  avatar: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: "center", justifyContent: "center"
  },
  avatarText: { color: "white", fontWeight: "800", fontSize: 14 },
  callInfo: { flex: 1, marginLeft: 12, marginRight: 8 },
  callName: { color: "#F3FAFF", fontSize: 15, fontWeight: "800" },
  missedName: { color: "#FFD8DD" },
  metaLine: { marginTop: 5, flexDirection: "row", alignItems: "center", gap: 5 },
  callMeta: { color: "#7D95A8", fontSize: 11.5, flex: 1 },
  missed: { color: "#FF6B7A" },
  rowAction: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: "#073B3C",
    alignItems: "center", justifyContent: "center"
  },
  rowActionSpaced: { marginLeft: 8, backgroundColor: "#0B2E4C" },

  empty: { alignItems: "center", paddingTop: 50, paddingHorizontal: 32, paddingBottom: 40 },
  emptyIcon: {
    width: 82, height: 82, borderRadius: 41, backgroundColor: "#0A2851",
    alignItems: "center", justifyContent: "center", marginBottom: 16
  },
  emptyTitle: { color: "#F7FBFF", fontSize: 19, fontWeight: "800" },
  emptyCopy: { color: "#7D95A8", fontSize: 13, textAlign: "center", lineHeight: 19, marginTop: 6 },
  emptyCta: {
    marginTop: 18, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#12D6AE", borderRadius: 13, paddingHorizontal: 18, paddingVertical: 11
  },
  emptyCtaText: { color: "#001B24", fontWeight: "800", fontSize: 13 },

  sheetBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.62)", justifyContent: "flex-end", padding: 12 },
  sheet: {
    backgroundColor: "#082536", borderRadius: 24, borderWidth: 1,
    borderColor: "#17445A", padding: 18, maxHeight: "85%"
  },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sheetTitle: { color: "#F6FBFF", fontSize: 21, fontWeight: "800" },
  sheetSubtitle: { color: "#7992A4", fontSize: 12, marginTop: 3 },
  sheetClose: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: "#0C3245",
    alignItems: "center", justifyContent: "center"
  },
  sheetScroll: { marginTop: 14 },
  sheetEmpty: { alignItems: "center", paddingVertical: 28, gap: 10, paddingHorizontal: 12 },
  sheetEmptyText: { color: "#7D95A8", fontSize: 12.5, textAlign: "center", lineHeight: 18 },
  sheetEmptyCta: {
    marginTop: 6, backgroundColor: "#0C3245", borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 10
  },
  sheetEmptyCtaText: { color: "#12D6AE", fontWeight: "800", fontSize: 12.5 },

  contactRow: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#123B4F"
  },
  contactName: { color: "#EFF7FD", fontSize: 14.5, fontWeight: "700" },
  contactMeta: { color: "#7290A4", fontSize: 11.5, marginTop: 2 },
  onlineDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E", marginRight: 8
  },

  presetWrap: { marginTop: 16, gap: 8 },
  preset: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#06202F", borderRadius: 13, borderWidth: 1,
    borderColor: "#164257", paddingHorizontal: 14, paddingVertical: 13
  },
  presetActive: { borderColor: "#12D6AE", backgroundColor: "#06302C" },
  presetText: { color: "#CFE3EF", fontSize: 13.5, fontWeight: "700" },
  presetTextActive: { color: "#12D6AE" },
  presetTime: { color: "#6E879B", fontSize: 12 },

  confirmButton: {
    marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 9, backgroundColor: "#12D6AE", borderRadius: 14, paddingVertical: 14
  },
  confirmButtonText: { color: "#001B24", fontWeight: "800", fontSize: 14 },

  scheduledRow: {
    flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "#123B4F"
  },
  scheduledIcon: {
    width: 38, height: 38, borderRadius: 12, backgroundColor: "#073B3C",
    alignItems: "center", justifyContent: "center"
  },
  scheduledWhen: { color: "#F1F9FF", fontSize: 14, fontWeight: "800" },
  scheduledWho: { color: "#93AABB", fontSize: 12, marginTop: 2 },
  scheduledMeta: { color: "#5E7C90", fontSize: 10.5, marginTop: 3, fontWeight: "600" },
  cancelButton: {
    borderRadius: 11, borderWidth: 1, borderColor: "#7A2B3A",
    backgroundColor: "#2A1620", paddingHorizontal: 12, paddingVertical: 8
  },
  cancelButtonText: { color: "#FF8B97", fontSize: 11.5, fontWeight: "800" }
});
