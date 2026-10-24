import { Fragment, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { collapseCrumbs, type Crumb } from "../navigation/breadcrumbs";
import { useTheme, type Palette } from "../theme/tokens";

/**
 * Breadcrumb trail. With `maxVisible`, middle crumbs collapse into a "…"
 * control that expands the full trail in place, so a long trail never hides
 * a reachable ancestor from touch or screen-reader users.
 */
export function Breadcrumb({ crumbs, maxVisible }: { crumbs: readonly Crumb[]; maxVisible?: number }) {
  const router = useRouter();
  const { colors } = useTheme();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [expanded, setExpanded] = useState(false);

  const { visible, hidden } =
    maxVisible && !expanded ? collapseCrumbs(crumbs, maxVisible) : { visible: [...crumbs], hidden: [] as Crumb[] };
  // Overflow marker sits after the first crumb, where the hidden ones were.
  const overflowAfter = hidden.length > 0 ? 0 : -1;

  return (
    <View accessibilityRole="header" accessibilityLabel="Breadcrumb">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row}>
        {visible.map((crumb, i) => {
          const current = crumb === crumbs[crumbs.length - 1] && i === visible.length - 1;
          return (
            <Fragment key={`${i}-${crumb.label}`}>
              {i > 0 && <Ionicons name="chevron-forward" size={14} color={colors.textFaint} style={s.sep} />}
              {current || !crumb.route ? (
                <Text style={current ? s.current : s.plain} accessibilityState={{ selected: current }} numberOfLines={1}>
                  {crumb.label}
                </Text>
              ) : (
                <Pressable
                  onPress={() => router.push(crumb.route as never)}
                  accessibilityRole="link"
                  accessibilityLabel={`Go to ${crumb.label}`}
                  style={s.hit}
                >
                  <Text style={s.link} numberOfLines={1}>{crumb.label}</Text>
                </Pressable>
              )}
              {i === overflowAfter && (
                <>
                  <Ionicons name="chevron-forward" size={14} color={colors.textFaint} style={s.sep} />
                  <Pressable
                    onPress={() => setExpanded(true)}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${hidden.length} more levels: ${hidden.map((h) => h.label).join(", ")}`}
                    style={s.hit}
                  >
                    <Text style={s.link}>…</Text>
                  </Pressable>
                </>
              )}
            </Fragment>
          );
        })}
      </ScrollView>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  row: { alignItems: "center", paddingRight: 12 },
  sep: { marginHorizontal: 4 },
  hit: { minHeight: 44, minWidth: 32, justifyContent: "center" },
  link: { color: c.accent, fontSize: 15, fontWeight: "700" },
  plain: { color: c.textMuted, fontSize: 15, fontWeight: "600" },
  current: { color: c.text, fontSize: 15, fontWeight: "900" }
});
