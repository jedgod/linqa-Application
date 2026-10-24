import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Switch, Text, View, useColorScheme } from "react-native";
import type { Theme } from "../../services/conversation-engine";
import {
  DIM_STEPS, WALLPAPERS, WALLPAPER_CATEGORIES, getWallpaper, systemWallpaperId, wallpaperTheme, type Wallpaper, type WallpaperCategory
} from "../../services/wallpapers";
import { SubHeader } from "./SubHeader";
import { WallpaperBackground } from "./WallpaperBackground";
import type { WallpaperState } from "./useWallpaper";
import { radius, space, type } from "./theme";

const COLUMNS = 3;

/**
 * Chat wallpaper picker. Tapping a wallpaper only previews it; the buttons at the bottom save it, either for this chat
 * alone or as the person's default for every chat. With `scope="default"` (no chat open) only the default can be set.
 */
export function WallpaperPicker({ theme: t, state, scope, chatName, onBack }: {
  theme: Theme;
  state: WallpaperState;
  scope: "chat" | "default";
  /** First name shown in the preview chat bubble. */
  chatName?: string;
  onBack: () => void;
}) {
  const systemScheme = useColorScheme();
  const [draftId, setDraftId] = useState(scope === "chat" ? state.wallpaper.id : (state.defaultId ?? state.wallpaper.id));
  const [category, setCategory] = useState<WallpaperCategory>(getWallpaper(draftId).category);
  const [status, setStatus] = useState<{ text: string; bad?: boolean } | null>(null);
  const draft = getWallpaper(draftId);
  const preview = useMemo(() => wallpaperTheme(draft, state.dim), [draft, state.dim]);
  // Padded to full rows with blanks so a short last row keeps the same tile width.
  const items = useMemo(() => {
    const inCategory: Array<Wallpaper | { id: string; blank: true }> = WALLPAPERS.filter((w) => w.category === category);
    while (inCategory.length % COLUMNS !== 0) inCategory.push({ id: `blank-${inCategory.length}`, blank: true });
    return inCategory;
  }, [category]);

  // Saves are synchronous (see useWallpaper), so there is no pending state: what the status says is what is stored.
  function run(work: () => boolean, done: string) {
    setStatus(work() ? { text: done } : { text: "Couldn't save that on this device. Try again.", bad: true });
  }

  const useHere = () => run(() => state.setForChat(draftId), `${draft.name} is now this chat's wallpaper.`);
  const makeDefault = () => run(() => {
    const ok = state.setDefault(draftId);
    if (ok && state.chatId) return state.setForChat(null); // let the new default show in this chat too
    return ok;
  }, `${draft.name} is now your default wallpaper.`);
  const followDefault = () => run(() => state.setForChat(null), "This chat now follows your default wallpaper.");
  // On: no default is stored, so the wallpaper matches the phone (Light Mode Original or Classic Dark Doodle) and follows it live.
  // Off: pin what is showing now as the default, so it stays put when the phone changes appearance.
  const matchSystem = state.defaultId === null;
  const toggleMatchSystem = (on: boolean) => run(() => {
    const ok = on ? state.setDefault(null) : state.setDefault(state.wallpaper.id);
    if (ok && on) setDraftId(systemWallpaperId(systemScheme));
    return ok;
  }, on ? "Your wallpaper now matches your phone's light or dark appearance." : `${state.wallpaper.name} is now your default wallpaper.`);
  // Dimming applies to every chat's wallpaper, so it saves as soon as it is chosen and the preview shows it live.
  const chooseDim = (level: number) => run(() => state.setDim(level), level === 0 ? "Dimming is off." : `Wallpaper dimmed ${Math.round(level * 100)}%.`);

  const card = ({ item }: { item: Wallpaper | { id: string; blank: true } }) => {
    if ("blank" in item) return <View style={styles.cardWrap} />;
    const selected = item.id === draftId;
    const isDefault = item.id === (state.defaultId ?? systemWallpaperId(systemScheme));
    return (
      <Pressable
        testID={`theme-tile-${item.id}`}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${item.name}${isDefault ? ", your default" : ""}`}
        onPress={() => { setDraftId(item.id); setStatus(null); }}
        style={styles.cardWrap}
      >
        <View style={[styles.swatch, { borderColor: selected ? t.accent : t.line, borderWidth: selected ? 2 : 1 }]}>
          <WallpaperBackground wallpaper={item} />
          <View style={[styles.dot, { backgroundColor: item.accentColor }]} />
          {isDefault ? <View style={[styles.badge, { backgroundColor: t.accent }]}><Text style={[styles.badgeText, { color: t.onAccent }]}>DEFAULT</Text></View> : null}
        </View>
        <Text style={[type.meta, { color: selected ? t.accent : t.muted, fontWeight: selected ? "700" : "400" }]} numberOfLines={2}>{item.name}</Text>
      </Pressable>
    );
  };

  const header = (
    <View>
      <View accessible accessibilityLabel={`Preview of ${draft.name}`} style={styles.preview}>
        <WallpaperBackground wallpaper={draft} dim={state.dim} />
        <View style={[styles.bubble, styles.incoming, { backgroundColor: preview.incoming }]}>
          <Text style={[type.body, { color: preview.ink }]}>{chatName ? `Hi, it's ${chatName}.` : "Hi there."}</Text>
        </View>
        <View style={[styles.bubble, styles.outgoing, { backgroundColor: preview.outgoing }]}>
          <Text style={[type.body, { color: preview.onOutgoing }]}>This is how your chat will look.</Text>
        </View>
      </View>
      <View style={[styles.syncRow, { borderColor: t.line }]}>
        <View style={{ flex: 1 }}>
          <Text style={[type.body, { color: t.ink }]}>Match system appearance</Text>
          <Text style={[type.meta, { color: t.muted }]}>
            {matchSystem ? "Light Mode Original in light, Classic Dark Doodle in dark, until you pick one." : "Using your chosen default. Turn on to follow your phone again."}
          </Text>
        </View>
        <Switch accessibilityLabel="Match system appearance" value={matchSystem} onValueChange={toggleMatchSystem} />
      </View>
      <Text style={[type.meta, styles.dimLabel, { color: t.muted }]}>Dimming (all your chats)</Text>
      <View style={styles.dimRow} accessibilityRole="radiogroup" accessibilityLabel="Wallpaper dimming">
        {DIM_STEPS.map((level) => {
          const on = state.dim === level;
          const label = level === 0 ? "Off" : `${Math.round(level * 100)}%`;
          return (
            <Pressable key={level} testID={`dim-step-${Math.round(level * 100)}`} accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={level === 0 ? "Dimming off" : `Dim ${label}`} onPress={() => chooseDim(level)} style={[styles.dimStep, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.highlight : "transparent" }]}>
              <Text style={[type.meta, { color: on ? t.ink : t.muted, fontWeight: on ? "700" : "400" }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {WALLPAPER_CATEGORIES.map((c) => {
          const on = c === category;
          return (
            <Pressable key={c} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setCategory(c)} style={[styles.tab, { borderColor: on ? t.accent : t.line, backgroundColor: on ? t.highlight : "transparent" }]}>
              <Text style={[type.meta, { color: on ? t.ink : t.muted, fontWeight: on ? "700" : "400" }]}>{c}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable testID={primary ? "apply-wallpaper-btn" : undefined} accessibilityRole="button" onPress={onPress} style={[styles.button, primary ? { backgroundColor: t.accent } : { borderColor: t.line, borderWidth: 1 }]}>
      <Text style={[type.title, { fontSize: 15, color: primary ? t.onAccent : t.ink }]}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.fill, { backgroundColor: t.background }]}>
      <SubHeader theme={t} title="Chat wallpaper" subtitle={scope === "chat" ? "Only changes how this looks to you" : "Your default for every chat"} onBack={onBack} />
      <FlatList
        data={items}
        keyExtractor={(w) => w.id}
        numColumns={COLUMNS}
        renderItem={card}
        ListHeaderComponent={header}
        contentContainerStyle={styles.list}
        columnWrapperStyle={styles.row}
        extraData={draftId}
        accessibilityRole="radiogroup"
      />
      <View style={[styles.actions, { backgroundColor: t.surface, borderTopColor: t.line }]}>
        {status ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={[type.meta, { color: status.bad ? t.danger : t.secure, textAlign: "center" }]}>{status.text}</Text> : null}
        {scope === "chat" ? (
          <>
            {button("Use for this chat", useHere, true)}
            {button("Set as default for all chats", makeDefault)}
            {state.chatId ? button("Follow my default", followDefault) : null}
          </>
        ) : (
          <>
            {button("Set as default", makeDefault, true)}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  list: { padding: space.m, paddingBottom: space.xl },
  row: { gap: space.m, marginBottom: space.m },
  preview: { height: 124, borderRadius: radius.bubble, overflow: "hidden", justifyContent: "center", padding: space.m, gap: space.s, marginBottom: space.m },
  bubble: { maxWidth: "78%", paddingHorizontal: space.m, paddingVertical: space.s, borderRadius: radius.bubble },
  incoming: { alignSelf: "flex-start" },
  outgoing: { alignSelf: "flex-end" },
  syncRow: { flexDirection: "row", alignItems: "center", gap: space.m, borderWidth: 1, borderRadius: radius.bubble - 6, padding: space.m, marginBottom: space.m },
  dimLabel: { marginBottom: space.xs },
  dimRow: { flexDirection: "row", gap: space.s, marginBottom: space.m },
  dimStep: { flex: 1, minHeight: 36, borderWidth: 1, borderRadius: radius.control, alignItems: "center", justifyContent: "center" },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: space.s, marginBottom: space.m },
  tab: { borderWidth: 1, borderRadius: radius.control, paddingHorizontal: space.m, paddingVertical: 6, minHeight: 32, justifyContent: "center" },
  cardWrap: { flex: 1 / COLUMNS, gap: 4 },
  swatch: { aspectRatio: 0.8, borderRadius: radius.bubble - 6, overflow: "hidden", justifyContent: "flex-end", alignItems: "flex-end", padding: 6 },
  dot: { width: 22, height: 14, borderRadius: 7 },
  badge: { position: "absolute", top: 6, left: 6, borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  actions: { paddingHorizontal: space.m, paddingVertical: space.s, gap: space.xs + 2, borderTopWidth: StyleSheet.hairlineWidth },
  button: { minHeight: 42, borderRadius: radius.control, alignItems: "center", justifyContent: "center" }
});
