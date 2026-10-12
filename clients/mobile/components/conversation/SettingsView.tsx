import React from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { BACKGROUNDS, BACKGROUND_CHOICES, THREAD_ACTIONS, unavailableReason, type ChatBackground, type ThreadAction } from "../../services/conversation-thread";
import { DISAPPEAR_CHOICES, THEMES, THEME_CHOICES, disappearLabel, type ConversationPrefs, type Theme, type ThemeChoice } from "../../services/conversation-engine";
import type { GateState } from "../../services/conversation-types";
import { radius, space, type } from "./theme";
import { SubHeader } from "./SubHeader";

interface Props {
  theme: Theme;
  peerName: string;
  peerFirstName: string;
  gate: GateState;
  prefs: ConversationPrefs;
  featureSupport?: readonly ThreadAction[];
  blocked: boolean;
  pinned: boolean;
  disappearAfterSeconds: number | null;
  onPinnedChange: (pinned: boolean) => void;
  onDisappearChange: (seconds: number | null) => void;
  onChange: (next: ConversationPrefs) => void;
  onVerify: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  /** Present only when this chat is readable: hands its recent text to Linqa AI after confirmation. */
  onAskAi?: () => void;
  /** Group people, and the actions that work on the whole chat. These are the same as on Linqa for computers. */
  chat?: { isGroup: boolean; members: Array<{ name: string; role: string }>; onAddPeople?: () => void; onReport: () => void; onClear: () => void; onDelete: () => void };
  onBack: () => void;
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
const LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

/** Conversation settings: privacy, appearance, notifications, block. Only settings that really do something are live. */
export function SettingsView({ theme: t, peerName, peerFirstName, gate, prefs, featureSupport, blocked, pinned, disappearAfterSeconds, onPinnedChange, onDisappearChange, onChange, onVerify, onBlock, onUnblock, onAskAi, chat, onBack }: Props) {
  const status = blocked ? "Blocked" : gate.mode === "LIVE" ? "End-to-end encrypted" : gate.mode === "CHECKING" ? "Checking encryption" : "Messages sealed on this device";
  const section = (label: string) => <Text style={[type.meta, styles.section, { color: t.muted }]}>{label.toUpperCase()}</Text>;
  const card = [styles.card, { backgroundColor: t.surface }];

  const swatch = (choice: ThemeChoice) => {
    const selected = prefs.theme === choice;
    return (
      <Pressable key={choice} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => onChange({ ...prefs, theme: choice })} style={styles.swatchWrap}>
        <View style={[styles.swatch, { borderColor: selected ? t.accent : t.line, borderWidth: selected ? 2 : 1 }]}>
          {choice === "system" ? (
            <View style={[styles.fill, styles.fillRow]}><View style={[styles.half, { backgroundColor: THEMES.light.surface }]} /><View style={[styles.half, { backgroundColor: THEMES.dark.background }]} /></View>
          ) : <View style={[styles.fill, { backgroundColor: choice === "light" ? THEMES.light.surface : THEMES.dark.background }]} />}
        </View>
        <Text style={[type.meta, { color: selected ? t.accent : t.muted, fontWeight: selected ? "700" : "400" }]}>{LABEL[choice]}</Text>
      </Pressable>
    );
  };

  const notYet = (what: string) => Alert.alert(what, "This isn't available in this version yet.");

  return (
    <View style={[styles.fill, { backgroundColor: t.background }]}>
      <SubHeader theme={t} title="Conversation settings" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: t.surface }]}><Text style={[styles.avatarText, { color: t.accent }]}>{initials(peerName)}</Text></View>
          <Text accessibilityRole="header" style={[styles.name, { color: t.ink }]}>{peerName}</Text>
          <Text style={[type.body, { color: t.muted }]}>{status}</Text>
        </View>

        {onAskAi ? (
          <>
            {section("Linqa AI")}
            <View style={card}>
              <Pressable accessibilityRole="button" onPress={onAskAi} style={styles.rowTop}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: t.ink }]}>Ask Linqa AI about this chat</Text>
                  <Text style={[type.body, { color: t.muted }]}>Summaries, action items, replies. You confirm what is shared.</Text>
                </View>
                <Text style={[styles.chevron, { color: t.muted }]}>›</Text>
              </Pressable>
            </View>
          </>
        ) : null}

        {section("Privacy")}
        <View style={card}>
          <Pressable accessibilityRole="button" onPress={onVerify} style={styles.rowTop}>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: t.ink }]}>Verify safety number</Text>
              <Text style={[type.body, { color: prefs.verified ? t.accent : t.warn }]}>{prefs.verified ? "Verified" : "Not verified yet"}</Text>
            </View>
            <Text style={[styles.chevron, { color: t.muted }]}>›</Text>
          </Pressable>
          <View style={[styles.disappear, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Text style={[type.body, { color: t.ink }]}>Disappearing messages</Text>
            <View style={[styles.segment, { backgroundColor: t.background }]} accessibilityRole="radiogroup">
              {DISAPPEAR_CHOICES.map((choice) => {
                const selected = (disappearAfterSeconds ?? null) === choice.seconds;
                return (
                  <Pressable key={choice.label} accessibilityRole="radio" accessibilityState={{ selected }} onPress={() => onDisappearChange(choice.seconds)} style={[styles.segmentItem, selected && { backgroundColor: t.surface, borderColor: t.line, borderWidth: StyleSheet.hairlineWidth }]}>
                    <Text style={[type.meta, { color: selected ? t.ink : t.muted, fontWeight: selected ? "700" : "400" }]}>{choice.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[type.meta, { color: t.muted }]}>
              {disappearAfterSeconds ? `New messages disappear after ${disappearLabel(disappearAfterSeconds)}, for both of you. Messages already sent keep their time.` : "Messages stay until someone deletes them. Turning this on applies to new messages, for both of you."}
            </Text>
          </View>
        </View>

        {section("Appearance")}
        <View style={[card, styles.appearance]}>
          <Text style={[type.body, { color: t.ink, flex: 1 }]}>Theme for this conversation</Text>
          <View style={styles.swatches}>{THEME_CHOICES.map(swatch)}</View>
        </View>

        {section("Change background")}
        <View style={[card, styles.bgCard]}>
          <View style={styles.bgRow} accessibilityRole="radiogroup">
            {BACKGROUND_CHOICES.map((choice) => {
              const selected = prefs.background === choice.id;
              const fill = choice.id === "AUTO" ? t.background : BACKGROUNDS[choice.id as Exclude<ChatBackground, "AUTO">];
              return (
                <Pressable key={choice.id} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${choice.label} background`} onPress={() => onChange({ ...prefs, background: choice.id })} style={styles.swatchWrap}>
                  <View style={[styles.bgSwatch, { backgroundColor: fill, borderColor: selected ? t.accent : t.line, borderWidth: selected ? 2 : 1 }]} />
                  <Text style={[type.meta, { color: selected ? t.accent : t.muted, fontWeight: selected ? "700" : "400" }]}>{choice.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[type.meta, { color: t.muted }]}>Only changes how this chat looks to you. {peerFirstName} isn't told.</Text>
        </View>

        {section("Add features")}
        <View style={card}>
          {THREAD_ACTIONS.map((item, i) => {
            const reason = featureSupport ? (featureSupport.includes(item.id) ? null : "Unavailable") : unavailableReason(item.id);
            const on = prefs.features.includes(item.id);
            return (
              <View key={item.id} style={[styles.rowTop, i > 0 && { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[type.body, { color: t.ink }]}>{item.label}</Text>
                  <Text style={[type.meta, { color: reason ? t.muted : t.accent }]}>{reason ? "Not available right now" : item.needsConsent ? "Asks before sharing" : "Available"}</Text>
                </View>
                <Switch accessibilityLabel={`Show ${item.label} in the add menu`} value={on} onValueChange={(next) => onChange({ ...prefs, features: next ? THREAD_ACTIONS.map((a) => a.id).filter((id) => id === item.id || prefs.features.includes(id)) : prefs.features.filter((id) => id !== item.id) })} trackColor={{ true: t.accent }} />
              </View>
            );
          })}
        </View>
        <Text style={[type.meta, { color: t.muted, marginHorizontal: space.xs, marginTop: space.xs, marginBottom: space.s }]}>Turn a feature off to hide it from the ✦ menu in this chat.</Text>

        {section("Conversation")}
        <View style={card}>
          <View style={styles.rowTop}>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: t.ink }]}>Pin conversation</Text>
              <Text style={[type.meta, { color: t.muted }]}>{pinned ? "Kept at the top of your chats" : "Keep it at the top of your chats"}</Text>
            </View>
            <Switch accessibilityLabel="Pin conversation" value={pinned} onValueChange={onPinnedChange} trackColor={{ true: t.accent }} />
          </View>
        </View>

        {chat?.isGroup ? (
          <>
            {section(`People · ${chat.members.length}`)}
            <View style={card}>
              {chat.members.map((m, i) => (
                <View key={`${m.name}-${i}`} style={[styles.rowTop, i > 0 ? { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth } : null]}>
                  <Text style={[type.body, { color: t.ink, flex: 1 }]}>{m.name}</Text>
                  {m.role !== "MEMBER" ? <Text style={[type.meta, { color: t.muted }]}>{m.role === "OWNER" ? "Owner" : "Admin"}</Text> : null}
                </View>
              ))}
              {chat.onAddPeople ? (
                <Pressable accessibilityRole="button" onPress={chat.onAddPeople} style={[styles.rowTop, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                  <Text style={[type.body, { color: t.accent, fontWeight: "600" }]}>Add people</Text>
                </Pressable>
              ) : null}
            </View>
          </>
        ) : null}

        {section("Notifications")}
        <View style={card}>
          <View style={styles.rowTop}>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: t.ink }]}>Mute this conversation</Text>
              <Text style={[type.meta, { color: t.muted }]}>{prefs.quiet ? "Alerts are off for this conversation" : "Notifications on"}</Text>
            </View>
            <Switch accessibilityLabel="Mute this conversation" value={prefs.quiet} onValueChange={(quiet) => onChange({ ...prefs, quiet })} trackColor={{ true: t.accent }} />
          </View>
          <View style={[styles.rowTop, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth, opacity: 0.55 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[type.body, { color: t.ink }]}>Show message text in alerts</Text>
              <Text style={[type.meta, { color: t.muted }]}>Off. Not available in this version yet.</Text>
            </View>
            <Switch value={false} disabled />
          </View>
          <Pressable accessibilityRole="button" onPress={blocked ? onUnblock : onBlock} style={[styles.rowTop, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
            <Text style={[type.body, { color: blocked ? t.accent : t.danger, fontWeight: "600" }]}>{blocked ? `Unblock ${peerFirstName}` : `Block ${peerFirstName}`}</Text>
          </Pressable>
          {chat ? (
            <>
              <Pressable accessibilityRole="button" onPress={chat.onReport} style={[styles.rowTop, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <Text style={[type.body, { color: t.danger, fontWeight: "600" }]}>{chat.isGroup ? "Report group" : `Report ${peerFirstName}`}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={chat.onClear} style={[styles.rowTop, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <Text style={[type.body, { color: t.danger, fontWeight: "600" }]}>Clear chat</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={chat.onDelete} style={[styles.rowTop, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
                <Text style={[type.body, { color: t.danger, fontWeight: "600" }]}>Delete chat</Text>
              </Pressable>
            </>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => notYet("Delete conversation")} style={[styles.rowTop, { borderTopColor: t.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[type.body, { color: t.danger, fontWeight: "600" }]}>Delete conversation from this device</Text>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: space.l, paddingBottom: space.xl * 2 },
  identity: { alignItems: "center", gap: space.xs, marginVertical: space.l },
  avatar: { width: 96, height: 96, borderRadius: 48, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 34, fontWeight: "700" },
  name: { fontSize: 24, fontWeight: "700", marginTop: space.s },
  section: { marginTop: space.l, marginBottom: space.s, marginLeft: space.xs, letterSpacing: 0.5 },
  card: { borderRadius: radius.bubble, overflow: "hidden" },
  rowTop: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.l, paddingVertical: space.m + 2, minHeight: 60, gap: space.m },
  disappear: { paddingHorizontal: space.l, paddingVertical: space.m + 2, gap: space.s },
  segment: { flexDirection: "row", borderRadius: 12, padding: 3 },
  segmentItem: { flex: 1, minHeight: 38, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 0 },
  bgCard: { padding: space.l, gap: space.s },
  bgRow: { flexDirection: "row", justifyContent: "space-between" },
  bgSwatch: { width: 52, height: 52, borderRadius: 14 },
  chevron: { fontSize: 28, lineHeight: 30 },
  appearance: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.l, paddingVertical: space.m },
  swatches: { flexDirection: "row", gap: space.m },
  swatchWrap: { alignItems: "center", gap: space.xs },
  swatch: { width: 58, height: 58, borderRadius: 14, overflow: "hidden" },
  half: { flex: 1 },
  fillRow: { flexDirection: "row" }
});
