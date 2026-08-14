import React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { CreateAction, CreateActionKey, GLOBAL_CREATE_ACTIONS } from "../navigation/information-architecture";

export function QuickCreateSheet({
  visible, onClose, onAction, actions = GLOBAL_CREATE_ACTIONS, contextLabel
}: {
  visible: boolean;
  onClose(): void;
  onAction(key: CreateActionKey): void;
  actions?: readonly CreateAction[];
  contextLabel?: string;
}) {
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Create</Text>
              <Text style={styles.subtitle}>{contextLabel || "Start something new in Linqa"}</Text>
            </View>
            <Pressable style={styles.close} onPress={onClose}>
              <Ionicons name="close" size={20} color="#A8BDC9" />
            </Pressable>
          </View>

          <View style={styles.grid}>
            {actions.map(({ key, icon, label }) => (
              <Pressable key={key} style={styles.item} onPress={() => onAction(key)} accessibilityRole="button">
                <View style={styles.itemIcon}>
                  <Ionicons name={icon} size={23} color="#12D6AE" />
                </View>
                <Text style={styles.itemText}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,.62)", justifyContent: "flex-end", padding: 12 },
  card: { backgroundColor: "#082536", borderRadius: 24, borderWidth: 1, borderColor: "#17445A", padding: 18 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: "#F6FBFF", fontSize: 22, fontWeight: "800" },
  subtitle: { color: "#7992A4", fontSize: 12, marginTop: 3 },
  close: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: "#0C3245",
    alignItems: "center", justifyContent: "center"
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 18 },
  item: {
    width: "31%", minHeight: 98, borderRadius: 16, backgroundColor: "#06202F",
    borderWidth: 1, borderColor: "#164257", alignItems: "center",
    justifyContent: "center", padding: 10
  },
  itemIcon: {
    width: 42, height: 42, borderRadius: 13, backgroundColor: "#073B3C",
    alignItems: "center", justifyContent: "center"
  },
  itemText: { color: "#DCEAF2", fontSize: 12, fontWeight: "700", marginTop: 8, textAlign: "center" }
});
