import { useEffect, useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useSegments } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { actionLabel, getModule, LINQA_MODULES } from "../modules/catalog";
import { isGatedModule, moduleAvailable, type ModuleKey } from "../src/runtime/module-gates";
import { RuntimeCapabilitiesService, type MobileCapabilitySnapshot } from "../services/runtime-capabilities.service";
import { avatarPalette, colors, radius, spacing } from "../theme/tokens";
import { getApiBaseUrl } from "../config/api";

const API_BASE_URL = getApiBaseUrl();
const MODULE_ALIASES: Record<string, ModuleKey> = { authentication: "auth", chats: "chat" };
const WORKFLOW_COMPLETE: Record<string, boolean> = {
  auth: true,
  chat: process.env.EXPO_PUBLIC_WORKFLOW_CHAT_COMPLETE === "true",
  conversation: process.env.EXPO_PUBLIC_WORKFLOW_CHAT_COMPLETE === "true",
  calls: process.env.EXPO_PUBLIC_WORKFLOW_CALLS_COMPLETE === "true",
  contacts: process.env.EXPO_PUBLIC_WORKFLOW_CONTACTS_COMPLETE === "true",
  "file-vault": process.env.EXPO_PUBLIC_WORKFLOW_FILE_VAULT_COMPLETE === "true",
  security: process.env.EXPO_PUBLIC_WORKFLOW_SECURITY_COMPLETE === "true",
  "linked-devices": process.env.EXPO_PUBLIC_WORKFLOW_LINKED_DEVICES_COMPLETE === "true",
  account: true,
  emergency: process.env.EXPO_PUBLIC_WORKFLOW_EMERGENCY_COMPLETE === "true",
  countrylinqa: process.env.EXPO_PUBLIC_WORKFLOW_COUNTRYLINQA_COMPLETE === "true"
};

const ACTION_ROUTES: Record<string, string> = {
  search: "/search",
  notifications: "/settings/notifications",
  "message-requests": "/message-requests",
  "privacy-center": "/privacy-center",
  "privacy-status": "/privacy-center",
  "privacy-rights": "/settings/privacy-rights",
  "data-export": "/settings/privacy-rights",
  "account-deletion": "/settings/privacy-rights",
  accessibility: "/settings/accessibility",
  "storage-usage": "/settings/storage",
  "clear-cache": "/settings/storage",
  "privacy-mode": "/settings/ai-privacy",
  "ai-assistant": "/modules/ai",
  "ai-chat": "/modules/ai",
  "key-transparency": "/security/key-transparency",
  "linked-devices": "/privacy-center",
  "security-alerts": "/privacy-center",
  support: "/support",
  "contact-support": "/support",
  "priority-support": "/support",
  "file-vault": "/modules/file-vault",
  "emergency-sos": "/modules/emergency",
  "call-history": "/(tabs)/calls",
  "missed-calls": "/(tabs)/calls",
  "scheduled-calls": "/(tabs)/calls",
  "new-call": "/(tabs)/calls",
  "audio-call": "/(tabs)/calls",
  "voice-call": "/(tabs)/calls",
  "video-call": "/(tabs)/calls",
  media: "/(tabs)/media",
  communities: "/(tabs)/communities",
  "new-community": "/(tabs)/communities",
  "new-chat": "/(tabs)/chats",
  "new-message": "/(tabs)/chats",
  profile: "/modules/account",
  advanced: "/modules/advanced-settings",
  about: "/modules/about",
  countrylinqa: "/countrylinqa/world",
  "send-money": "/linqasend"
};

/**
 * Per-action icon, matched by substring so new action keys in modules/catalog.ts
 * get a reasonable icon for free instead of needing an entry here. Order
 * matters: first match wins, so more specific keys are listed before the
 * generic terms they contain (e.g. "video-call" before "call").
 */
const ICON_RULES: Array<[string, keyof typeof Ionicons.glyphMap]> = [
  ["search", "search"],
  ["notification", "notifications-outline"],
  ["new-message", "chatbubble-outline"],
  ["new-chat", "chatbubble-outline"],
  ["message", "chatbubbles-outline"],
  ["video-call", "videocam-outline"],
  ["video", "videocam-outline"],
  ["voice-call", "call-outline"],
  ["audio-call", "call-outline"],
  ["new-call", "call-outline"],
  ["call", "call-outline"],
  ["camera", "camera-outline"],
  ["photo", "image-outline"],
  ["voice-note", "mic-outline"],
  ["voice-dictation", "mic-outline"],
  ["mic", "mic-outline"],
  ["screen-share", "tv-outline"],
  ["screen", "tv-outline"],
  ["record", "radio-button-on-outline"],
  ["translate", "language-outline"],
  ["ai-", "sparkles-outline"],
  ["ai", "sparkles-outline"],
  ["emoji", "happy-outline"],
  ["sticker", "happy-outline"],
  ["gif", "images-outline"],
  ["document", "document-outline"],
  ["file-vault", "lock-closed-outline"],
  ["file", "document-outline"],
  ["vault", "lock-closed-outline"],
  ["location", "location-outline"],
  ["poll", "bar-chart-outline"],
  ["calendar", "calendar-outline"],
  ["event", "calendar-outline"],
  ["reminder", "alarm-outline"],
  ["payment", "card-outline"],
  ["wallet", "wallet-outline"],
  ["billing", "card-outline"],
  ["subscription", "card-outline"],
  ["plan", "pricetag-outline"],
  ["upgrade", "arrow-up-circle-outline"],
  ["contact", "person-add-outline"],
  ["group", "people-outline"],
  ["communit", "people-circle-outline"],
  ["member", "people-outline"],
  ["role", "shield-outline"],
  ["moderator", "shield-outline"],
  ["favorite", "star-outline"],
  ["star", "star-outline"],
  ["pin", "pin-outline"],
  ["bookmark", "bookmark-outline"],
  ["archive", "archive-outline"],
  ["block", "hand-left-outline"],
  ["hidden", "eye-off-outline"],
  ["report", "flag-outline"],
  ["delete", "trash-outline"],
  ["remove", "trash-outline"],
  ["edit", "create-outline"],
  ["rewrite", "create-outline"],
  ["reply", "arrow-undo-outline"],
  ["forward", "arrow-redo-outline"],
  ["copy", "copy-outline"],
  ["export", "download-outline"],
  ["download", "download-outline"],
  ["upload", "cloud-upload-outline"],
  ["backup", "cloud-upload-outline"],
  ["restore", "cloud-download-outline"],
  ["sync", "sync-outline"],
  ["storage", "server-outline"],
  ["cache", "server-outline"],
  ["diagnostics", "pulse-outline"],
  ["log", "list-outline"],
  ["network", "globe-outline"],
  ["proxy", "globe-outline"],
  ["vpn", "shield-checkmark-outline"],
  ["relay", "globe-outline"],
  ["security", "shield-checkmark-outline"],
  ["encryption", "lock-closed-outline"],
  ["audit", "shield-checkmark-outline"],
  ["safety-number", "finger-print-outline"],
  ["biometric", "finger-print-outline"],
  ["fingerprint", "finger-print-outline"],
  ["face-id", "scan-outline"],
  ["passkey", "key-outline"],
  ["pin-code", "keypad-outline"],
  ["two-step", "shield-checkmark-outline"],
  ["recovery", "refresh-circle-outline"],
  ["key-transparency", "key-outline"],
  ["session", "time-outline"],
  ["device", "phone-portrait-outline"],
  ["qr", "qr-code-outline"],
  ["scan", "scan-outline"],
  ["linked-devices", "phone-portrait-outline"],
  ["revoke", "close-circle-outline"],
  ["verify", "checkmark-circle-outline"],
  ["account", "person-circle-outline"],
  ["profile", "person-circle-outline"],
  ["username", "at-outline"],
  ["password", "lock-closed-outline"],
  ["email", "mail-outline"],
  ["phone", "call-outline"],
  ["switch-account", "swap-horizontal-outline"],
  ["switch", "swap-horizontal-outline"],
  ["add-account", "person-add-outline"],
  ["add", "add-circle-outline"],
  ["invite", "person-add-outline"],
  ["sos", "warning-outline"],
  ["emergency", "warning-outline"],
  ["escalation", "trending-up-outline"],
  ["medical", "medkit-outline"],
  ["cancel", "close-circle-outline"],
  ["appearance", "color-palette-outline"],
  ["color", "color-palette-outline"],
  ["language", "language-outline"],
  ["accessibility", "accessibility-outline"],
  ["font-size", "text-outline"],
  ["contrast", "contrast-outline"],
  ["captions", "text-outline"],
  ["haptics", "phone-portrait-outline"],
  ["sound", "volume-high-outline"],
  ["mute", "volume-mute-outline"],
  ["speaker", "volume-high-outline"],
  ["bluetooth", "bluetooth-outline"],
  ["transfer", "swap-horizontal-outline"],
  ["reaction", "happy-outline"],
  ["drawing", "brush-outline"],
  ["whiteboard", "easel-outline"],
  ["mention", "at-outline"],
  ["premium", "diamond-outline"],
  ["enterprise", "business-outline"],
  ["organization", "business-outline"],
  ["directory", "list-outline"],
  ["sso", "log-in-outline"],
  ["policy", "document-text-outline"],
  ["policies", "document-text-outline"],
  ["legal", "document-text-outline"],
  ["compliance", "shield-checkmark-outline"],
  ["retention", "time-outline"],
  ["admin", "settings-outline"],
  ["support", "help-buoy-outline"],
  ["help", "help-buoy-outline"],
  ["about", "information-circle-outline"],
  ["version", "information-circle-outline"],
  ["license", "document-text-outline"],
  ["terms", "document-text-outline"],
  ["whitepaper", "document-text-outline"],
  ["developer", "code-slash-outline"],
  ["feature-flag", "flag-outline"],
  ["fixture", "flask-outline"],
  ["reset", "refresh-outline"],
  ["status", "radio-button-on-outline"],
  ["setting", "settings-outline"],
  ["signin", "log-in-outline"],
  ["sign-in", "log-in-outline"],
  ["continue", "arrow-forward-circle-outline"],
  ["skip", "play-skip-forward-outline"],
  ["read-receipt", "checkmark-done-outline"],
  ["typing", "chatbox-ellipses-outline"],
  ["last-seen", "eye-outline"],
  ["disappearing", "timer-outline"],
  ["auto-delete", "timer-outline"],
  ["translation", "language-outline"],
  ["teleprompter", "reader-outline"],
  ["co-watch", "people-outline"],
  ["filter", "funnel-outline"],
  ["unread", "ellipse"],
  ["priority", "flag-outline"],
  ["quiet-hours", "moon-outline"],
  ["business", "briefcase-outline"],
  ["dashboard", "grid-outline"],
  ["quick-create", "flash-outline"],
  ["share-securely", "share-social-outline"],
  ["share", "share-social-outline"],
  ["offline", "cloud-offline-outline"],
  ["history", "time-outline"],
  ["view", "eye-outline"],
  ["rename", "create-outline"],
  ["limit", "speedometer-outline"]
];

function iconForAction(actionKey: string): keyof typeof Ionicons.glyphMap {
  const match = ICON_RULES.find(([needle]) => actionKey.includes(needle));
  return match ? match[1] : "ellipse-outline";
}

function colorForAction(actionKey: string): string {
  let hash = 0;
  for (let i = 0; i < actionKey.length; i += 1) hash = (hash * 31 + actionKey.charCodeAt(i)) >>> 0;
  return avatarPalette[hash % avatarPalette.length];
}

export function ModuleRouteScreen({ moduleKey }: { moduleKey: string }) {
  const router = useRouter();
  const segments = useSegments();
  const inTabs = segments[0] === "(tabs)";
  const [pendingAction, setPendingAction] = useState<string>();
  const [capabilities, setCapabilities] = useState<MobileCapabilitySnapshot>({});
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const selectedModule = getModule(moduleKey);
  const runtime = useMemo(() => new RuntimeCapabilitiesService(API_BASE_URL), []);

  useEffect(() => {
    runtime.snapshot().then(setCapabilities).catch(() => setCapabilities({})).finally(() => setCapabilitiesLoaded(true));
  }, [runtime]);

  const gateKey = MODULE_ALIASES[moduleKey] ?? moduleKey;
  const currentAvailable = !isGatedModule(gateKey) || moduleAvailable(gateKey, capabilities, WORKFLOW_COMPLETE);

  if (!selectedModule) {
    return (
      <SafeAreaView edges={inTabs ? ["left", "right"] : ["top", "right", "bottom", "left"]} style={styles.screen}>
        <Text style={styles.title}>Module unavailable</Text>
      </SafeAreaView>
    );
  }

  function handleAction(actionKey: string) {
    setPendingAction(actionKey);
    const route = ACTION_ROUTES[actionKey];
    const targetModule = LINQA_MODULES.find((item) => item.key === actionKey);

    if (route) {
      router.push(route as never);
      setPendingAction(undefined);
      return;
    }
    if (targetModule) {
      router.push(`/modules/${targetModule.key}` as never);
      setPendingAction(undefined);
      return;
    }

    setPendingAction(undefined);
    Alert.alert(
      actionLabel(actionKey),
      "This control requires its dedicated secure workflow or provider. It remains unavailable rather than simulating success."
    );
  }

  const availableActions = selectedModule.actions;
  const searchAction = availableActions.find((actionKey) => actionKey === "search");
  const listedActions = availableActions.filter((actionKey) => actionKey !== searchAction);

  return (
    <SafeAreaView edges={inTabs ? ["left", "right"] : ["top", "right", "bottom", "left"]} style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.heading}>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>LINQA MODULE</Text>
            <Text style={styles.title}>{selectedModule.title}</Text>
            <Text style={styles.subtitle}>Choose an action</Text>
          </View>
          {searchAction && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search"
              onPress={() => handleAction(searchAction)}
              style={({ pressed }) => [styles.searchButton, pressed && styles.actionPressed]}
            >
              <Ionicons name="search" size={20} color={colors.accent} />
            </Pressable>
          )}
        </View>
        {capabilitiesLoaded && !currentAvailable ? (
          <View style={styles.runtimeNotice}>
            <View style={styles.runtimeIcon}><Ionicons name="shield-outline" size={19} color="#FFCA57" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.runtimeTitle}>Interface available · secure actions limited</Text>
              <Text style={styles.runtimeCopy}>You can browse this page now. Provider-backed actions remain protected until their production dependencies are ready.</Text>
            </View>
          </View>
        ) : null}
        <View style={styles.grid}>
          {listedActions.map((actionKey) => (
            <Pressable
              accessibilityRole="button"
              key={actionKey}
              onPress={() => handleAction(actionKey)}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <View style={[styles.icon, { backgroundColor: `${colorForAction(actionKey)}26` }]}>
                {pendingAction === actionKey ? (
                  <ActivityIndicator color={colorForAction(actionKey)} />
                ) : (
                  <Ionicons name={iconForAction(actionKey)} size={19} color={colorForAction(actionKey)} />
                )}
              </View>
              <Text style={styles.actionText}>{actionLabel(actionKey)}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: 120 },
  heading: { marginTop: 12, marginBottom: spacing.lg, flexDirection: "row", alignItems: "flex-start" },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: "800", letterSpacing: 1.2 },
  title: { color: colors.text, fontSize: 28, fontWeight: "900", marginTop: 3 },
  subtitle: { color: colors.textMuted, marginTop: 4 },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center"
  },
  grid: { gap: spacing.xs + 3 },
  runtimeNotice: { marginBottom: spacing.lg, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: "#6B5521", backgroundColor: "#2B2517", flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  runtimeIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#493B1B", alignItems: "center", justifyContent: "center" },
  runtimeTitle: { color: "#FFE39A", fontSize: 13, fontWeight: "900" },
  runtimeCopy: { color: "#C8B983", fontSize: 12, lineHeight: 16, marginTop: 3 },
  action: {
    minHeight: 60,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md
  },
  actionPressed: { backgroundColor: colors.surfaceAlt },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center"
  },
  actionText: { color: colors.text, fontSize: 14, fontWeight: "700", flex: 1 }
});
