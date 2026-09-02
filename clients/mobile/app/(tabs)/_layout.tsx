import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, usePathname, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AccountSwitcherSheet } from "../../components/AccountSwitcherSheet";
import { QuickCreateSheet } from "../../components/QuickCreateSheet";
import { useAccounts } from "../../account/AccountContext";
import { createActionsForPath } from "../../navigation/information-architecture";
import { ActivityIndicator } from "react-native";
import { OnboardingApiService } from "../../services/onboarding.service";
import { HomeFeedService, type HomeBadges } from "../../services/home-feed.service";
import { accessTokenProvider } from "../../services/session";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8080";

/**
 * Floor between badge refreshes. The tab bar re-renders on every navigation,
 * and unread counts do not change fast enough to be worth a request each time.
 */
const BADGE_REFRESH_MS = 10_000;

/**
 * Unread chats and missed calls for the tab bar.
 *
 * Deliberately not the Home feed: this mounts on every authenticated screen,
 * and `GET /v1/mobile/home/badges` is three indexed counts rather than a news
 * fetch. A failure leaves the badges absent, which is the honest state — an
 * unknown count must not be drawn as zero *or* as a stale number.
 */
function useTabBadges(accountId: string | undefined, pathname: string): HomeBadges | null {
  const client = useMemo(
    () => new HomeFeedService(API, () => accessTokenProvider.getAccessToken()),
    []
  );
  const [badges, setBadges] = useState<HomeBadges | null>(null);
  const lastFetch = useRef(0);

  const refresh = useCallback(
    (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastFetch.current < BADGE_REFRESH_MS) return;
      lastFetch.current = now;
      client
        .loadBadges()
        .then(setBadges)
        .catch(() => setBadges(null));
    },
    [client]
  );

  useEffect(() => {
    setBadges(null);
    lastFetch.current = 0;
    refresh(true);
  }, [accountId, refresh]);

  useEffect(() => {
    refresh(false);
  }, [pathname, refresh]);

  return badges;
}

/** `tabBarBadge` wants the count omitted, not zeroed, when there is nothing. */
function badgeValue(count: number | undefined): number | undefined {
  return count && count > 0 ? count : undefined;
}

function AccountHeader() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accounts, active, activate } = useAccounts();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <View style={[s.header, { height: 58 + insets.top, paddingTop: insets.top }] }>
      <Text style={s.brand}>Linqa</Text>
      <Pressable style={s.avatarBtn} onPress={() => setSwitcherOpen(true)} accessibilityLabel="Switch account">
        <Ionicons name="person-circle-outline" size={26} color="#12D6AE" />
        {active?.label || active?.displayName ? <Text style={s.avatarLabel}>{active.label || active.displayName}</Text> : null}
      </Pressable>

      <AccountSwitcherSheet
        visible={switcherOpen}
        accounts={accounts}
        activeUserId={active?.userId}
        onClose={() => setSwitcherOpen(false)}
        onSwitch={(userId) => {
          activate(userId);
          setSwitcherOpen(false);
          router.replace("/onboarding/resolve");
        }}
        onAdd={() => {
          setSwitcherOpen(false);
          router.push("/account/add-phone");
        }}
        onManage={() => {
          setSwitcherOpen(false);
          router.push("/account/manage");
        }}
      />
    </View>
  );
}

export default function TabsLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const [createOpen, setCreateOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const actions = createActionsForPath(pathname);
  const { active } = useAccounts();
  const badges = useTabBadges(active?.userId, pathname);
  const onboarding = useMemo(() => new OnboardingApiService(API, accessTokenProvider), []);
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setAllowed(false);
    onboarding.status().then((status) => {
      if (cancelled) return;
      if (status.nextStep !== "COMPLETE") router.replace("/onboarding/resolve");
      else setAllowed(true);
    }).catch(() => { if (!cancelled) router.replace("/onboarding/resolve"); });
    return () => { cancelled = true; };
  }, [active?.userId, onboarding, router]);

  if (!allowed) return <View style={s.guard}><ActivityIndicator color="#6558DC" /></View>;

  return (
    <>
      <Tabs
        screenOptions={{
          headerShown: true,
          header: () => <AccountHeader />,
          tabBarStyle: [s.tabBar, { height: 64 + Math.max(insets.bottom, 8), paddingBottom: Math.max(insets.bottom, 8) }],
          tabBarLabelStyle: s.tabLabel,
          tabBarBadgeStyle: s.tabBadge,
          tabBarActiveTintColor: "#5B4CFF",
          tabBarInactiveTintColor: "#596078"
        }}
      >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          headerShown: false,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="calls"
        options={{
          title: "Calls",
          tabBarBadge: badgeValue(badges?.calls),
          tabBarAccessibilityLabel: badges?.calls
            ? `Calls, ${badges.calls} missed`
            : "Calls",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="call-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: "Create",
          tabBarLabel: () => null,
          tabBarButton: () => (
            <Pressable
              style={s.createButton}
              onPress={() => setCreateOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Create"
            >
              <Ionicons name="add" size={36} color="#FFFFFF" />
            </Pressable>
          )
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          // Chats draws its own dark header; the shared account header would
          // sit above it as a light band.
          headerShown: false,
          tabBarBadge: badgeValue(badges?.chats),
          tabBarAccessibilityLabel: badges?.chats
            ? `Chats, ${badges.chats} unread`
            : "Chats",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen
        name="linqa"
        options={{
          title: "Linqa",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          )
        }}
      />
      <Tabs.Screen name="communities" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="media" options={{ href: null }} />
      </Tabs>

      <QuickCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        actions={actions}
        contextLabel={pathname === "/" || pathname.includes("home") ? "Start something new in Linqa" : "Actions for this part of Linqa"}
        onAction={(key) => {
          const selected = actions.find((item) => item.key === key);
          setCreateOpen(false);
          if (selected) router.push(selected.route as never);
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  header: {
    minHeight: 58,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: 1,
    borderBottomColor: "#E7E9F2",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  brand: { color: "#10132E", fontWeight: "900", fontSize: 19 },
  avatarBtn: { flexDirection: "row", alignItems: "center", gap: 6 },
  avatarLabel: { color: "#596078", fontSize: 12, fontWeight: "700" },
  tabBar: {
    height: 72,
    paddingTop: 8,
    paddingBottom: 8,
    backgroundColor: "#FFFFFF",
    borderTopColor: "#E8EAF2",
    borderTopWidth: 1,
    elevation: 12,
    shadowColor: "#171B4A",
    shadowOpacity: 0.09,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 }
  },
  tabLabel: { fontSize: 11, fontWeight: "700" },
  tabBadge: { backgroundColor: "#FF3B4E", color: "#FFFFFF", fontSize: 10, fontWeight: "900", minWidth: 18, lineHeight: 15 },
  createButton: {
    alignSelf: "center",
    top: -17,
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5B4CFF",
    borderWidth: 5,
    borderColor: "#F7F7FC",
    shadowColor: "#5B4CFF",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8
  },
  guard: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFFFFF" }
});
