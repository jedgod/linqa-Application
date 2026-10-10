import React from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { palette as c, space } from "./tokens";

/** Header with Cancel, scrollable body, sticky primary button. Used by every composer. */
export function FormShell(props: {
  title: string;
  onCancel: () => void;
  cta: string;
  ctaDisabled?: boolean;
  onSubmit: () => void;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
}) {
  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.header}>
        <View style={styles.bar}>
          <Pressable onPress={props.onCancel} accessibilityRole="button" style={styles.cancel} hitSlop={8}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {props.title}
          </Text>
          <View style={styles.cancel} />
        </View>
        {props.headerExtra}
      </View>
      <View style={styles.body}>{props.children}</View>
      <View style={styles.footer}>
        <Pressable
          onPress={props.onSubmit}
          disabled={props.ctaDisabled}
          accessibilityRole="button"
          accessibilityState={{ disabled: !!props.ctaDisabled }}
          style={[styles.cta, props.ctaDisabled && styles.ctaOff]}
        >
          <Text style={[styles.ctaText, props.ctaDisabled && { color: c.muted }]}>{props.cta}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

export function Segmented({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.seg} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={o} onPress={() => onChange(o)} accessibilityRole="radio" accessibilityState={{ checked: on }} style={[styles.segBtn, on && styles.segOn]}>
            <Text style={[styles.segText, on && { color: c.ink }]}>{o}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: c.bg },
  header: { backgroundColor: c.surface, paddingTop: 52, paddingHorizontal: space.l, paddingBottom: space.m, gap: space.s, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
  bar: { flexDirection: "row", alignItems: "center" },
  cancel: { minWidth: 60, minHeight: 44, justifyContent: "center" },
  cancelText: { fontSize: 16, color: c.ink },
  title: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600", color: c.ink },
  body: { flex: 1 },
  footer: { backgroundColor: c.surface, padding: space.l, paddingBottom: 34, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.line },
  cta: { height: 48, borderRadius: 24, backgroundColor: c.secure, alignItems: "center", justifyContent: "center" },
  ctaOff: { backgroundColor: c.line },
  ctaText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  seg: { flexDirection: "row", backgroundColor: c.bg, borderRadius: 12, padding: 4, gap: 4 },
  segBtn: { flex: 1, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  segOn: { backgroundColor: c.surface, shadowColor: "#1C2833", shadowOpacity: 0.18, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segText: { fontSize: 13, fontWeight: "600", color: c.muted },
});
