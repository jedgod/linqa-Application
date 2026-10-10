import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { applyTone, SKIN_TONES, type EmojiItem, type Sticker } from "./catalog";
import type { Theme } from "../../../services/conversation-engine";
import { useEmojiSheet } from "./useEmojiSheet";

const PURPLE = "#6D4AFF";
const INK = "#1E1B4B";

type Sheet = ReturnType<typeof useEmojiSheet>;

type Props = {
  sheet: Sheet;
  onClose: () => void;
  /** The conversation theme; without it the sheet keeps its own light colours. */
  theme?: Theme;
};

export function EmojiPanel({ sheet, onClose, theme }: Props) {
  const tone = sheet.prefs?.defaultTone ?? 0;
  const skin = theme ? { sheet: { backgroundColor: theme.surface }, ink: { color: theme.ink }, muted: { color: theme.muted }, field: { backgroundColor: theme.background, color: theme.ink } } : null;
  return (
    <View style={[styles.sheet, skin?.sheet]}>
      <View style={styles.handle} />
      <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, skin?.ink]}>{sheet.tab === "emoji" ? "Emojis" : "Stickers"}</Text>
        <View style={styles.headerRight}>
          {sheet.tab === "emoji" &&
            SKIN_TONES.slice(1).map((item) => (
              <Pressable
                key={item.id}
                accessibilityLabel={item.label}
                onPress={() => sheet.setDefaultTone(item.id)}
                style={[styles.swatch, { backgroundColor: item.swatch }, tone === item.id && styles.swatchOn]}
              />
            ))}
          <Pressable accessibilityLabel="Close emoji panel" onPress={onClose} style={styles.close}>
            <Text style={[styles.closeText, skin?.muted]}>×</Text>
          </Pressable>
        </View>
      </View>

      <TextInput
        value={sheet.query}
        onChangeText={sheet.setQuery}
        placeholder={sheet.tab === "emoji" ? "Search emojis" : "Search stickers"}
        placeholderTextColor={theme?.muted ?? "#94A3B8"}
        accessibilityLabel={sheet.tab === "emoji" ? "Search emojis" : "Search stickers"}
        style={[styles.search, skin?.field]}
      />

      <View style={styles.tabs}>
        <Tab label="Emoji" selected={sheet.tab === "emoji"} onPress={() => sheet.setTab("emoji")} />
        <Tab label="Stickers" selected={sheet.tab === "stickers"} onPress={() => sheet.setTab("stickers")} />
      </View>

      {sheet.tab === "emoji" ? <EmojiGrid sheet={sheet} skin={skin} /> : <StickerGrid sheet={sheet} skin={skin} />}
      {sheet.toneTarget && <ToneRow sheet={sheet} base={sheet.toneTarget} skin={skin} />}
    </View>
  );
}

function Tab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={label} onPress={onPress} style={[styles.tab, selected && styles.tabOn]}>
      <Text style={[styles.tabText, selected && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

type Skin = { sheet: object; ink: object; muted: object; field: object } | null;

function EmojiGrid({ sheet, skin }: { sheet: Sheet; skin: Skin }) {
  const recent = sheet.prefs?.recent ?? [];
  const data: { key: string; title: string; items: EmojiItem[] }[] = [
    { key: "recent", title: "Recently used", items: recent.map((char) => ({ char, name: char })) },
    ...sheet.categories.map((category) => ({ key: category.id, title: category.label, items: category.items })),
  ];
  return (
    <FlatList
      data={data}
      keyExtractor={(item) => item.key}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <View>
          <Text style={[styles.section, skin?.muted]}>{item.title}</Text>
          <View style={styles.grid}>
            {item.items.map((emoji) => (
              <Pressable
                key={`${item.key}-${emoji.name}`}
                accessibilityLabel={emoji.name}
                onPress={() => sheet.insert(emoji.char, emoji.tonable)}
                onLongPress={() => emoji.tonable && sheet.setToneTarget(emoji.char)}
                style={styles.cell}
              >
                <Text style={styles.emoji}>
                  {emoji.tonable ? applyTone(emoji.char, sheet.prefs?.tones[emoji.char] ?? sheet.prefs?.defaultTone ?? 0) : emoji.char}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    />
  );
}

function StickerGrid({ sheet, skin }: { sheet: Sheet; skin: Skin }) {
  const favorites = new Set(sheet.prefs?.favoriteIds ?? []);
  const favs = sheet.stickers.filter((sticker) => favorites.has(sticker.id));
  return (
    <FlatList
      data={[{ title: "Favorites", items: favs }, { title: "Linqa", items: sheet.stickers }]}
      keyExtractor={(item) => item.title}
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => (
        <View>
          <Text style={[styles.section, skin?.muted]}>{item.title}</Text>
          <View style={styles.grid}>
            {item.items.map((sticker) => (
              <Pressable
                key={`${item.title}-${sticker.id}`}
                accessibilityLabel={sticker.label}
                accessibilityHint="Long press to favorite"
                onPress={() => sheet.sendSticker(sticker)}
                onLongPress={() => sheet.favorite(sticker)}
                style={styles.sticker}
              >
                <Text style={styles.emoji}>{sticker.emoji}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    />
  );
}

function ToneRow({ sheet, base, skin }: { sheet: Sheet; base: string; skin: Skin }) {
  return (
    <View style={[styles.toneRow, skin?.sheet]}>
      {SKIN_TONES.map((item) => (
        <Pressable key={item.id} accessibilityLabel={item.label} onPress={() => sheet.chooseTone(base, item.id)} style={styles.cell}>
          <Text style={styles.emoji}>{applyTone(base, item.id)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { maxHeight: 420, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 8 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "#E2E8F0", marginTop: 8 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 10 },
  title: { fontSize: 22, fontWeight: "700", color: INK },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  swatch: { width: 16, height: 16, borderRadius: 8 },
  swatchOn: { borderWidth: 2, borderColor: PURPLE },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  closeText: { fontSize: 22, color: "#64748B" },
  search: { marginHorizontal: 16, marginTop: 10, backgroundColor: "#F4F1FB", borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, color: INK },
  tabs: { flexDirection: "row", margin: 16, backgroundColor: "#F4F1FB", borderRadius: 999, padding: 4 },
  tab: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: 999 },
  tabOn: { backgroundColor: PURPLE },
  tabText: { fontWeight: "600", color: "#64748B" },
  tabTextOn: { color: "#fff" },
  section: { marginLeft: 16, marginBottom: 6, color: "#64748B", fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 8 },
  cell: { width: "14.28%", alignItems: "center", paddingVertical: 6 },
  sticker: { width: "25%", alignItems: "center", paddingVertical: 8 },
  emoji: { fontSize: 28 },
  toneRow: { flexDirection: "row", justifyContent: "center", backgroundColor: "#fff", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#F1F5F9" },
});
