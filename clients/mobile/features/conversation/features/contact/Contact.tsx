// Share a contact card. The sender picks which numbers and emails go along,
// so sharing someone's name doesn't automatically share everything about them.

import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as Contacts from "expo-contacts/legacy";
import { ContactContent } from "../../content/types";
import { FormShell } from "../../ui/Form";
import { withSystemUi } from "../../../../services/system-ui-guard";
import { palette as light, space } from "../../ui/tokens";
import { Palette, useThemed } from "../../ui/ThreadPalette";

export function ContactComposer({ onSend, onCancel }: { onSend: (k: ContactContent) => Promise<void>; onCancel: () => void }) {
  const { c, styles } = useThemed(makeStyles);
  const [contact, setContact] = useState<Contacts.Contact | null>(null);
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const perm = await withSystemUi(() => Contacts.requestPermissionsAsync());
      if (!active) return;
      if (!perm.granted) {
        Alert.alert("Contacts access is off", "Allow access in Settings to share a contact.", [{ text: "OK", onPress: onCancel }]);
        return;
      }
      const picked = await withSystemUi(() => Contacts.presentContactPickerAsync());
      if (!active) return;
      if (!picked) return onCancel();
      setContact(picked);
      // Phones on by default, emails off: the common case, and the less revealing one.
      const init: Record<string, boolean> = {};
      picked.phoneNumbers?.forEach((p, i) => (init[`p${i}`] = i === 0));
      picked.emails?.forEach((_, i) => (init[`e${i}`] = false));
      setInclude(init);
    })().catch(() => { if (active) Alert.alert("Contacts unavailable", "The contact picker couldn't be opened.", [{text:"OK",onPress:onCancel}]); });
    return () => { active = false; };
  }, []);

  if (!contact) return null;
  const name = contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unnamed";

  const send = async () => {
    setBusy(true);
    try {
      await onSend({
        type: "contact",
        name,
        organization: contact.company || undefined,
        jobTitle: contact.jobTitle || undefined,
        phones: contact.phoneNumbers?.filter((_, i) => include[`p${i}`]).map((p) => ({ label: p.label, number: p.number ?? "" })).filter((p) => p.number),
        emails: contact.emails?.filter((_, i) => include[`e${i}`]).map((e) => ({ label: e.label, address: e.email ?? "" })).filter((e) => e.address),
      });
    } finally {
      setBusy(false);
    }
  };

  const rows = [
    ...(contact.phoneNumbers ?? []).map((p, i) => ({ key: `p${i}`, label: p.label ?? "phone", value: p.number ?? "" })),
    ...(contact.emails ?? []).map((e, i) => ({ key: `e${i}`, label: e.label ?? "email", value: e.email ?? "" })),
  ];

  return (
    <FormShell title="Share contact" onCancel={onCancel} cta={busy ? "Sending" : `Send ${name}`} ctaDisabled={busy} onSubmit={send}>
      <ScrollView contentContainerStyle={styles.form}>
        <View style={styles.head}>
          <Avatar name={name} size={56} />
          <View>
            <Text style={styles.name}>{name}</Text>
            {contact.jobTitle || contact.company ? <Text style={styles.sub}>{[contact.jobTitle, contact.company].filter(Boolean).join(", ")}</Text> : null}
          </View>
        </View>
        <Text style={styles.section}>Choose what to include</Text>
        <View style={styles.card}>
          {rows.length === 0 ? <Text style={styles.sub}>Only the name will be shared.</Text> : null}
          {rows.map((r) => (
            <Pressable
              key={r.key}
              onPress={() => setInclude((s) => ({ ...s, [r.key]: !s[r.key] }))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: !!include[r.key] }}
              style={styles.row}
            >
              <View style={[styles.box, include[r.key] && styles.boxOn]}>{include[r.key] ? <Text style={styles.tick}>✓</Text> : null}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.value}>{r.value}</Text>
                <Text style={styles.sub}>{r.label}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </FormShell>
  );
}

export function ContactCard({ contact, outgoing, onMessage }: { contact: ContactContent; outgoing: boolean; onMessage?: () => void }) {
  const { c, styles } = useThemed(makeStyles);
  const save = async () => {
    const perm = await Contacts.requestPermissionsAsync();
    if (!perm.granted) return Alert.alert("Contacts access is off", "Allow access in Settings to save this contact.");
    const [first, ...rest] = contact.name.split(" ");
    await Contacts.presentFormAsync(null, {
      contactType: Contacts.ContactTypes.Person,
      name: contact.name,
      firstName: first,
      lastName: rest.join(" ") || undefined,
      company: contact.organization,
      jobTitle: contact.jobTitle,
      phoneNumbers: contact.phones?.map((p) => ({ label: p.label ?? "mobile", number: p.number })),
      emails: contact.emails?.map((e) => ({ label: e.label ?? "work", email: e.address })),
    } as Contacts.Contact);
  };
  return (
    <View style={[styles.bubble, outgoing ? styles.bubbleOut : styles.bubbleIn]}>
      <View style={styles.head}>
        <Avatar name={contact.name} size={42} />
        <View style={{ flex: 1 }}>
          <Text style={styles.cardName}>{contact.name}</Text>
          {contact.jobTitle || contact.organization ? <Text style={styles.sub}>{[contact.jobTitle, contact.organization].filter(Boolean).join(", ")}</Text> : null}
          {contact.phones?.[0] ? <Text style={styles.sub}>{contact.phones[0].number}</Text> : null}
        </View>
      </View>
      <View style={styles.actions}>
        {onMessage ? (
          <Pressable onPress={onMessage} accessibilityRole="button" style={[styles.action, { backgroundColor: c.secureTint }]}>
            <Text style={[styles.actionText, { color: c.secure }]}>Message</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => { void save().catch(() => Alert.alert("Not saved", "The contact couldn't be saved. Try again.")); }} accessibilityRole="button" style={styles.action}>
          <Text style={styles.actionText}>Save</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Avatar({ name, size }: { name: string; size: number }) {
  const { c, styles } = useThemed(makeStyles);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#DCD5E6", alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.36, fontWeight: "600", color: c.ink }}>{initials}</Text>
    </View>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  form: { padding: space.l, gap: space.m },
  head: { flexDirection: "row", alignItems: "center", gap: space.m },
  name: { fontSize: 20, fontWeight: "600", color: c.ink },
  cardName: { fontSize: 15, fontWeight: "600", color: c.ink },
  sub: { fontSize: 13, color: c.muted },
  section: { fontSize: 13, fontWeight: "600", color: c.muted, marginLeft: space.xs },
  card: { backgroundColor: c.surface, borderRadius: 14, padding: space.s },
  row: { flexDirection: "row", alignItems: "center", gap: space.m, minHeight: 56, paddingHorizontal: space.s },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: "#8796A4", alignItems: "center", justifyContent: "center" },
  boxOn: { backgroundColor: c.secure, borderColor: c.secure },
  tick: { color: c.onSecure, fontWeight: "700", fontSize: 14 },
  value: { fontSize: 16, color: c.ink },
  bubble: { width: 260, borderRadius: 18, padding: 12, gap: 10, backgroundColor: c.surface },
  bubbleIn: { borderBottomLeftRadius: 6 },
  bubbleOut: { borderBottomRightRadius: 6, borderWidth: 1.5, borderColor: c.outgoing },
  actions: { flexDirection: "row", gap: 6 },
  action: { flex: 1, height: 38, borderRadius: 12, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" },
  actionText: { fontSize: 14, fontWeight: "600", color: c.ink },
});
