import { PersonAvatar } from "../account/PersonAvatar";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "../LinearGradient";
import * as ImagePicker from "expo-image-picker";
import { useAccounts } from "../../account/AccountContext";
import { ChatInboxService } from "../../services/chat-inbox.service";
import { ConversationService } from "../../services/conversation.service";
import { parseBody } from "../../services/conversation-engine";
import { sharedSecureSession } from "../../services/shared-secure-session";
import { accessTokenProvider } from "../../services/session";
import { getApiBaseUrl } from "../../config/api";
import { WazeLocationMap } from "./WazeLocationMap";
import { wazePlaceLabel } from "../../config/waze";

export function CallLocationButton({ flag, area, onPress }: { flag?: string; area?: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`Open contact info. ${area || "Location unavailable"}`} onPress={onPress} style={s.locationButton}>
    <View style={s.flagRow}><Text style={s.flag} adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.75}>{flag || "🌐"}</Text><Ionicons name="chevron-forward" size={14} color="#aaa" /></View>
    <Text numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75} style={s.area}>{area || "Location unavailable"}</Text>
  </Pressable>;
}

type Tab = "Info" | "Backgrounds" | "Photos" | "Links";
const backgrounds = [
  { label: "None", colors: ["#000000", "#000000"] },
  { label: "Photo", colors: ["#303438", "#111111"] },
  { label: "Color", colors: ["#FF9F0A", "#FF7BC8"] },
  { label: "Sky", colors: ["#291D3F", "#6AA2B1", "#FF9F60"] },
  { label: "Water", colors: ["#36B9D3", "#C0DCEB"] },
  { label: "Aurora", colors: ["#062438", "#00BECA", "#442C83"] },
];

/** Contact details stay above the live call; closing this panel returns directly to it. */
export function CallContactPanel({ visible, onClose, name, peerId, flag, area, avatarUrl }: {
  visible: boolean; onClose: () => void; name: string; peerId?: string | null; flag?: string; area?: string; avatarUrl?: string;
}) {
  const { active } = useAccounts();
  const [tab, setTab] = useState<Tab>("Info");
  const [background, setBackground] = useState("None");
  const [photo, setPhoto] = useState<string | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cursor, setCursor] = useState<string>();
  const [conversation, setConversation] = useState<string>();
  const [service, setService] = useState<ConversationService>();
  const [page, setPage] = useState(0);
  const [sharedLocation, setSharedLocation] = useState<{ latitude: number; longitude: number; title?: string; address?: string }>();

  useEffect(() => { if (visible) { setTab("Info"); setBackground("None"); setPhoto(null); setPhotos([]); setLinks([]); setSharedLocation(undefined); setCursor(undefined); setConversation(undefined); setService(undefined); setPage(0); } }, [visible, peerId, active?.userId]);
  useEffect(() => {
    if (!visible || !active?.userId || !peerId) return;
    let live = true;
    setBusy(true); setMessage("");
    void (async () => {
      const api = getApiBaseUrl();
      const getToken = () => accessTokenProvider.getAccessToken();
      const secure = sharedSecureSession(active.userId);
      if (!secure) throw new Error("Secure chat is unavailable on this device.");
      const inbox = await new ChatInboxService(api, getToken).inbox("all");
      const chat = inbox.conversations.find(item => !item.isGroup && item.peerUserId === peerId);
      if (!chat) throw new Error("No shared chat is available.");
      const client = new ConversationService(api, getToken, active.userId, secure.messaging);
      if (live) { setConversation(chat.conversationId); setService(client); }
    })().catch(error => { if (live) setMessage(error.message || "Shared chat unavailable. Try reopening Info."); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [visible, peerId, active?.userId]);
  useEffect(() => {
    if (!visible || !service || !conversation) return;
    let live = true;
    setBusy(true);
    void (async () => {
      const history = await service.loadHistory(conversation, page === 0 ? undefined : cursor);
      const opened = await service.decryptServerRows(conversation, history.rows.filter(row => !row.deleted));
      const foundPhotos: string[] = [], foundLinks: string[] = [];
      for (const row of opened) {
        if (!row.ok || !live) continue;
        const payload = parseBody(row.text);
        const sender = history.rows.find(item => item.id === row.id)?.senderId;
        if (sender === peerId && payload?.type === "location") setSharedLocation(current => current ?? { latitude: payload.latitude, longitude: payload.longitude, title: payload.title, address: payload.address });
        if (sender === peerId && payload?.type === "feature" && payload.content.type === "location") {
          const location = payload.content;
          setSharedLocation(current => current ?? { latitude: location.latitude, longitude: location.longitude, title: location.label, address: location.address });
        }
        if (payload?.type === "text") foundLinks.push(...(payload.text.match(/https?:\/\/[^\s<>"\)]+/g) || []));
        if (payload?.type === "feature" && payload.content.type === "text") foundLinks.push(...(payload.content.text.match(/https?:\/\/[^\s<>"\)]+/g) || []));
        if (payload?.type === "media" && payload.mediaKind === "PHOTO") {
          if (sender) { try { const uri = await service.openMedia(conversation, sender, payload); foundPhotos.push(uri); } catch { /* A missing photo must not prevent other shared items from opening. */ } }
        }
      }
      if (live) { setPhotos(current => [...new Set([...current, ...foundPhotos])]); setLinks(current => [...new Set([...current, ...foundLinks])]); setCursor(history.nextCursor); }
    })().catch(() => { if (live) setMessage("Shared items could not be loaded. Reopen Info to retry."); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
    // The cursor is consumed only when Load more is pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, service, conversation, page]);

  const choosePhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (!result.canceled) { setPhoto(result.assets[0].uri); setBackground("Photo"); }
    } catch { Alert.alert("Photo unavailable", "Please try selecting the photo again."); }
  };
  const colors = backgrounds.find(item => item.label === background)!.colors;
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
    <LinearGradient colors={colors as [string, string, ...string[]]} style={s.fill}>
      {background === "Photo" && photo ? <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} blurRadius={18} /> : null}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: "#0009" }]} />
      <SafeAreaView style={s.fill}>
        <ScrollView contentContainerStyle={s.content}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to video call" onPress={onClose} style={s.back}><Ionicons name="chevron-back" color="white" size={30} /></Pressable>
          <PersonAvatar name={name} userId={peerId} photoUri={avatarUrl} size={100} backgroundColor="#30343D" style={{ alignSelf: "center" }} />
          <Text accessibilityRole="header" style={s.name}>{name}</Text>
          <View style={s.tabs}>{(["Info", "Backgrounds", "Photos", "Links"] as Tab[]).map(item => <Pressable key={item} accessibilityRole="tab" accessibilityState={{ selected: tab === item }} onPress={() => setTab(item)} style={[s.tab, tab === item && s.selectedTab]}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.65} style={[s.tabText, tab === item && { color: "white", fontWeight: "600" }]}>{item}</Text></Pressable>)}</View>
          {tab === "Info" ? <View style={s.locationCard}>
            {sharedLocation ? <WazeLocationMap key={`${sharedLocation.latitude}:${sharedLocation.longitude}`} latitude={sharedLocation.latitude} longitude={sharedLocation.longitude} placeLabel={wazePlaceLabel(sharedLocation.address, sharedLocation.title, name)} /> : <View style={s.locationEmpty}>{busy ? <ActivityIndicator color="#00A6FF" /> : <Ionicons name="location" size={42} color="#00A6FF" />}<Text style={s.muted}>{busy ? "Loading shared location…" : "No shared location available."}</Text></View>}
            <View style={s.locationCaption}><Text style={s.heading}>{flag} {area || "Shared location"}</Text><Text style={s.muted}>{sharedLocation ? "Shared in chat · not a live location" : "A map appears when a location is shared in chat."}</Text>{message ? <Text accessibilityRole="alert" style={s.muted}>{message}</Text> : null}</View>
          </View> : null}
          {tab === "Backgrounds" ? <><View style={s.swatches}>{backgrounds.map(item => <Pressable key={item.label} accessibilityRole="radio" accessibilityLabel={`${item.label} background`} accessibilityState={{ selected: background === item.label }} onPress={() => item.label === "Photo" ? void choosePhoto() : setBackground(item.label)} style={s.swatchWrap}><LinearGradient colors={item.colors as [string, string, ...string[]]} style={[s.swatch, background === item.label && s.chosen]}>{item.label === "Photo" && photo ? <Image source={{ uri: photo }} style={s.swatchImage} /> : null}{background === item.label ? <Ionicons name="checkmark-circle" color="#00A6FF" size={28} style={s.check} /> : null}</LinearGradient><Text style={s.tabText}>{item.label}</Text></Pressable>)}</View><Text style={s.muted}>Adjust the background of this contact panel during the call.</Text><Text style={s.heading}>Suggestions</Text><View style={s.grid}>{photos.map(uri => <Pressable key={uri} accessibilityRole="button" accessibilityLabel="Use shared photo as background" onPress={() => { setPhoto(uri); setBackground("Photo"); }} style={s.tile}><Image source={{ uri }} style={s.fill} /></Pressable>)}</View></> : null}
          {tab === "Photos" ? <><Text style={s.heading}>Photos shared together</Text><View style={s.grid}>{photos.map(uri => <View key={uri} style={s.tile}><Image source={{ uri }} style={s.fill} /></View>)}</View>{!busy && !photos.length ? <Text style={s.muted}>No shared photos in the loaded chat history.</Text> : null}</> : null}
          {tab === "Links" ? <><Text style={s.heading}>Links shared in chats</Text>{links.map(url => <Pressable key={url} accessibilityRole="link" onPress={() => void Linking.openURL(url).catch(() => Alert.alert("Link unavailable", "This link could not be opened."))} style={s.card}><Text style={s.link}>{url}</Text><Ionicons name="open-outline" color="#00A6FF" size={20} /></Pressable>)}{!busy && !links.length ? <Text style={s.muted}>No shared links in the loaded chat history.</Text> : null}</> : null}
          {tab !== "Info" && busy ? <ActivityIndicator color="#00A6FF" /> : null}
          {tab !== "Info" && message ? <Text accessibilityRole="alert" style={s.muted}>{message}</Text> : null}
          {tab !== "Info" && cursor ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => setPage(value => value + 1)} style={s.card}><Text style={s.link}>Load more shared items</Text></Pressable> : null}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  </Modal>;
}

const s = StyleSheet.create({
  fill: { flex: 1 }, content: { padding: 20, gap: 20, paddingBottom: 40 },
  locationButton: { borderRadius: 16, backgroundColor: "#222222", borderWidth: 1, borderColor: "#ffffff28", paddingHorizontal: 6, paddingVertical: 5, minHeight: 44, minWidth: 0, width: "100%", maxWidth: 112, alignItems: "center", alignSelf: "center" },
  flagRow: { flexDirection: "row", alignItems: "center", gap: 5 }, flag: { fontSize: 21 }, area: { color: "#B7B7B7", fontSize: 11, textAlign: "center", width: "100%" },
  back: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#ffffff20", alignItems: "center", justifyContent: "center" },
  avatar: { width: 100, height: 100, borderRadius: 50, alignSelf: "center" }, initial: { backgroundColor: "#30343D", alignItems: "center", justifyContent: "center" }, initialText: { color: "white", fontSize: 42 },
  name: { color: "white", fontSize: 34, fontWeight: "700", textAlign: "center" }, tabs: { flexDirection: "row", justifyContent: "space-between", gap: 2 }, tab: { flexShrink: 1, minWidth: 0, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 24 }, selectedTab: { backgroundColor: "#ffffff20", borderWidth: 1, borderColor: "#ffffff30" }, tabText: { color: "#b5b5b5", fontSize: 15 },
  card: { borderRadius: 28, backgroundColor: "#ffffff18", padding: 22, gap: 12 }, heading: { color: "white", fontSize: 23, fontWeight: "600" }, muted: { color: "#b5b5b5", fontSize: 15, lineHeight: 23 },
  locationCard: { borderRadius: 28, overflow: "hidden", backgroundColor: "#ffffff18" }, locationEmpty: { height: 230, alignItems: "center", justifyContent: "center", gap: 18, padding: 24 }, locationCaption: { padding: 22, gap: 10 },
  swatches: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 20 }, swatchWrap: { width: 80, alignItems: "center", gap: 8 }, swatch: { width: 76, height: 76, borderRadius: 38 }, chosen: { borderWidth: 3, borderColor: "#00A6FF" }, check: { position: "absolute", right: -2, bottom: -2 }, swatchImage: { width: "100%", height: "100%", borderRadius: 38 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, tile: { width: "47%", height: 190, borderRadius: 24, overflow: "hidden" }, link: { color: "#58BEFF", fontSize: 16 },
});
