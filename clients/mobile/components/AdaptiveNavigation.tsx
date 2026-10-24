import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Breadcrumb } from "./Breadcrumb";
import { AccountSwitchButton } from "./AccountSwitchButton";
import { QuickCreateSheet } from "./QuickCreateSheet";
import { useAccounts } from "../account/AccountContext";
import { useNavigationMode } from "../hooks/useIsTablet";
import { breadcrumbsForPath, resolveRoute } from "../navigation/breadcrumbs";
import { createActionsForPath } from "../navigation/information-architecture";
import { mayShowRoute, shellAllowedOnPath } from "../navigation/policy";
import { NAV_GROUPS, routes, type NavRoute } from "../navigation/registry";
import { isMoneyRoute, useLinqaSendAvailability } from "../services/linqasend-availability";
import { useTheme, type Palette } from "../theme/tokens";

/**
 * Tablet / large-window navigation shell: breadcrumb bar on every tier, a
 * permanent sidebar from 840dp, and a slide-in sidebar behind a menu button
 * between 600 and 840dp. Phones render `children` untouched (the Tabs layout
 * owns the phone bottom bar), so there is only ever one primary navigation.
 *
 * Presentation only. Route guards (onboarding, account, server authorization)
 * stay where they are; this just avoids offering links the user cannot use.
 */
export function AdaptiveNavigation({ children }: { children: ReactNode }) {
  const mode = useNavigationMode();
  const pathname = usePathname();
  const { active } = useAccounts();

  if (mode === "mobile" || !active || !shellAllowedOnPath(pathname)) return <>{children}</>;
  return <TabletShell mode={mode} pathname={pathname} signedIn>{children}</TabletShell>;
}

function TabletShell({
  mode, pathname, signedIn, children
}: {
  mode: "tablet-compact" | "tablet-expanded" | "desktop";
  pathname: string;
  signedIn: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const moneyAvailable = useLinqaSendAvailability();
  const compact = mode === "tablet-compact";
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  // A destination change (including Android back) always closes the drawer.
  useEffect(() => setDrawerOpen(false), [pathname]);

  const current = resolveRoute(pathname)?.route.id;
  const items = useMemo(
    () => routes.filter((r) => r.group && mayShowRoute(r, { signedIn, moneyAvailable })),
    [signedIn, moneyAvailable]
  );
  const crumbs = useMemo(() => breadcrumbsForPath(pathname), [pathname]);
  const actions = useMemo(
    () => createActionsForPath(pathname).filter((a) => moneyAvailable === true || !isMoneyRoute(a.route)),
    [pathname, moneyAvailable]
  );

  const go = (route: NavRoute) => {
    setDrawerOpen(false);
    if (pathname !== route.href) router.push(route.href as never);
  };

  const sidebar = (
    <ScrollView
      accessibilityLabel="Linqa navigation"
      style={[s.sidebar, compact && s.drawer, { paddingTop: insets.top + 12 }]}
      contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
    >
      <Text style={s.brand}>Linqa</Text>
      <Pressable
        onPress={() => { setDrawerOpen(false); setCreateOpen(true); }}
        accessibilityRole="button"
        accessibilityLabel="Create"
        style={s.create}
      >
        <Ionicons name="add" size={20} color={colors.onAccent} />
        <Text style={s.createText}>Create</Text>
      </Pressable>
      {NAV_GROUPS.map((group) => {
        const inGroup = items.filter((r) => r.group === group);
        if (inGroup.length === 0) return null;
        return (
          <Fragment key={group}>
            <Text style={s.groupLabel} accessibilityRole="header">{group}</Text>
            {inGroup.map((r) => {
              const selected = r.id === current;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => go(r)}
                  accessibilityRole="link"
                  accessibilityLabel={r.label}
                  accessibilityState={{ selected }}
                  style={[s.item, selected && s.itemSelected]}
                >
                  <Ionicons name={(r.icon ?? "ellipse-outline") as never} size={20} color={selected ? colors.accent : colors.textMuted} />
                  <Text style={[s.itemText, selected && s.itemTextSelected]} numberOfLines={1}>{r.label}</Text>
                </Pressable>
              );
            })}
          </Fragment>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={s.root}>
      {!compact && <View style={s.sidebarSlot}>{sidebar}</View>}
      <View style={s.main}>
        <View style={[s.bar, { paddingTop: insets.top }]}>
          {compact && (
            <Pressable
              onPress={() => setDrawerOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel={drawerOpen ? "Close navigation" : "Open navigation"}
              accessibilityState={{ expanded: drawerOpen }}
              style={s.menu}
            >
              <Ionicons name={drawerOpen ? "close" : "menu"} size={24} color={colors.text} />
            </Pressable>
          )}
          <View style={s.crumbs}>
            <Breadcrumb crumbs={crumbs} maxVisible={compact ? 3 : undefined} />
          </View>
          <AccountSwitchButton />
        </View>
        <View style={s.content}>{children}</View>
      </View>

      {compact && drawerOpen && (
        <>
          <Pressable
            style={s.scrim}
            onPress={() => setDrawerOpen(false)}
            accessibilityRole="button"
            accessibilityLabel="Close navigation"
          />
          {sidebar}
        </>
      )}

      <QuickCreateSheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        actions={actions}
        contextLabel="Quick actions"
        onAction={(key) => {
          const selected = actions.find((a) => a.key === key);
          setCreateOpen(false);
          if (selected) router.push(selected.route as never);
        }}
      />
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  root: { flex: 1, flexDirection: "row", backgroundColor: c.bg },
  sidebarSlot: { width: 248, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border, backgroundColor: c.surface },
  sidebar: { width: 248, backgroundColor: c.surface, paddingHorizontal: 12 },
  drawer: { position: "absolute", top: 0, bottom: 0, left: 0, zIndex: 20, elevation: 20 },
  scrim: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, zIndex: 10, backgroundColor: c.overlay },
  main: { flex: 1 },
  bar: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 12, minHeight: 56,
    backgroundColor: c.surface, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border
  },
  menu: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginRight: 4 },
  crumbs: { flex: 1, marginRight: 12 },
  content: { flex: 1 },
  brand: { color: c.accent, fontSize: 22, fontWeight: "900", marginHorizontal: 8, marginBottom: 14 },
  create: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 44,
    borderRadius: 12, backgroundColor: c.accent, marginBottom: 8
  },
  createText: { color: c.onAccent, fontWeight: "800", fontSize: 15 },
  groupLabel: { color: c.textFaint, fontSize: 12, fontWeight: "800", letterSpacing: 0.8, marginTop: 16, marginBottom: 4, marginHorizontal: 8, textTransform: "uppercase" },
  item: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 44, paddingHorizontal: 10, borderRadius: 10 },
  itemSelected: { backgroundColor: c.surfaceAlt },
  itemText: { color: c.textMuted, fontSize: 15, fontWeight: "600", flexShrink: 1 },
  itemTextSelected: { color: c.text, fontWeight: "800" }
});
