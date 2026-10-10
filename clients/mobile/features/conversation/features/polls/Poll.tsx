import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { ContentMessage, PollContent } from "../../content/types";
import { newId } from "../../content/codec";
import { nextVote, pollStatus, tallyPoll } from "./pollModel";
import { palette as c, space } from "../../ui/tokens";
import { FormShell, Segmented } from "../../ui/Form";

// --- composer ---------------------------------------------------------------

const CLOSE_OPTIONS = [
  { label: "In 1 hour", ms: 3600_000 },
  { label: "In 1 day", ms: 86_400_000 },
  { label: "Never", ms: 0 },
];

export function PollComposer({ onSend, onCancel }: { onSend: (p: PollContent) => Promise<void>; onCancel: () => void }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multi, setMulti] = useState(false);
  const [hideVoters, setHideVoters] = useState(false);
  const [close, setClose] = useState("In 1 day");
  const [busy, setBusy] = useState(false);

  const filled = options.map((o) => o.trim()).filter(Boolean);
  const dupes = new Set(filled.map((o) => o.toLowerCase())).size !== filled.length;
  const valid = question.trim().length > 0 && filled.length >= 2 && !dupes;

  const send = async () => {
    if (!valid) return;
    setBusy(true);
    const ms = CLOSE_OPTIONS.find((o) => o.label === close)!.ms;
    try {
      await onSend({
        type: "poll",
        pollId: newId("p"),
        question: question.trim(),
        options: filled.map((label, i) => ({ id: `o${i}`, label })),
        multi,
        hideVoters,
        closesAt: ms ? new Date(Date.now() + ms).toISOString() : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell title="New poll" onCancel={onCancel} cta={busy ? "Sending" : "Send poll"} ctaDisabled={!valid || busy} onSubmit={send}>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Field label="Question">
          <TextInput value={question} onChangeText={setQuestion} placeholder="Ask something" maxLength={300} style={styles.input} accessibilityLabel="Question" />
        </Field>
        <Text style={styles.section}>Answers</Text>
        {options.map((o, i) => (
          <View key={i} style={styles.optRow}>
            <TextInput
              value={o}
              onChangeText={(t) => setOptions((all) => all.map((x, j) => (j === i ? t : x)))}
              placeholder={`Answer ${i + 1}`}
              maxLength={300}
              style={[styles.input, styles.optInput]}
              accessibilityLabel={`Answer ${i + 1}`}
            />
            {options.length > 2 ? (
              <Pressable onPress={() => setOptions((all) => all.filter((_, j) => j !== i))} accessibilityRole="button" accessibilityLabel={`Remove answer ${i + 1}`} style={styles.remove}>
                <Text style={styles.removeText}>Remove</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
        {dupes ? <Text style={styles.error}>Two answers are the same.</Text> : null}
        {options.length < 12 ? (
          <Pressable onPress={() => setOptions((o) => [...o, ""])} accessibilityRole="button" style={styles.add}>
            <Text style={styles.addText}>Add an answer</Text>
          </Pressable>
        ) : null}
        <View style={styles.card}>
          <ToggleRow label="Allow more than one answer" value={multi} onChange={setMulti} />
          <ToggleRow label="Hide who voted" hint="Show totals only" value={hideVoters} onChange={setHideVoters} />
          <Text style={styles.label}>Close voting</Text>
          <Segmented options={CLOSE_OPTIONS.map((o) => o.label)} value={close} onChange={setClose} />
        </View>
      </ScrollView>
    </FormShell>
  );
}

// --- card in the thread -------------------------------------------------------

interface CardProps {
  poll: PollContent;
  messages: ContentMessage[];
  selfId: string;
  peerName: string;
  nameOf: (id: string) => string;
  outgoing: boolean;
  onVote: (optionIds: string[]) => void;
}

export function PollCard({ poll, messages, selfId, peerName, nameOf, outgoing, onVote }: CardProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    // Flip to "Closed" at the closing time even if no new message arrives.
    const closes = poll.closesAt ? Date.parse(poll.closesAt) : Infinity;
    const wait = closes - Date.now();
    if (!Number.isFinite(wait) || wait <= 0 || wait > 2 ** 31 - 1) return;
    const id = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(id);
  }, [poll.closesAt]);
  const t = useMemo(() => tallyPoll(poll, messages, selfId, now), [poll, messages, selfId, now]);
  const max = Math.max(1, t.totalVoters);

  return (
    <View style={[styles.bubble, outgoing ? styles.bubbleOut : styles.bubbleIn]}>
      <Text style={styles.kicker}>Poll{poll.multi ? ", pick any" : ""}</Text>
      <Text style={styles.question}>{poll.question}</Text>
      {poll.options.map((o) => {
        const n = t.counts[o.id] ?? 0;
        const mine = t.myVote.includes(o.id);
        const names = !poll.hideVoters ? t.voters[o.id].map((id) => (id === selfId ? "You" : nameOf(id))).join(", ") : "";
        return (
          <Pressable
            key={o.id}
            onPress={() => !t.closed && onVote(nextVote(poll, t.myVote, o.id))}
            disabled={t.closed}
            accessibilityRole={poll.multi ? "checkbox" : "radio"}
            accessibilityState={{ checked: mine, disabled: t.closed }}
            accessibilityLabel={`${o.label}, ${n} ${n === 1 ? "vote" : "votes"}${names ? `, ${names}` : ""}`}
            style={[styles.opt, mine && styles.optMine]}
          >
            <View style={[styles.bar, { width: `${(n / max) * 100}%` }, mine && styles.barMine]} />
            <Text style={styles.optLabel} numberOfLines={2}>
              {o.label}
            </Text>
            <Text style={styles.optCount}>{n}</Text>
          </Pressable>
        );
      })}
      <Text style={styles.status}>{pollStatus(t, peerName)}</Text>
    </View>
  );
}

// --- shared bits ---------------------------------------------------------------

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={{ flex: 1 }}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: c.secure, false: "#B5C0CA" }} accessibilityLabel={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { padding: space.l, gap: space.m },
  field: { backgroundColor: c.surface, borderRadius: 14, paddingHorizontal: space.l, paddingTop: space.s, paddingBottom: space.xs },
  label: { fontSize: 12, fontWeight: "600", color: c.muted },
  section: { fontSize: 12, fontWeight: "600", color: c.muted, marginLeft: space.xs },
  input: { minHeight: 44, fontSize: 16, color: c.ink },
  optRow: { flexDirection: "row", alignItems: "center", backgroundColor: c.surface, borderRadius: 14, paddingLeft: space.l },
  optInput: { flex: 1 },
  remove: { minHeight: 44, paddingHorizontal: space.m, justifyContent: "center" },
  removeText: { color: c.muted, fontSize: 13, fontWeight: "600" },
  add: { minHeight: 48, borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#8796A4", justifyContent: "center", paddingHorizontal: space.l },
  addText: { color: c.secure, fontWeight: "600", fontSize: 15 },
  error: { color: c.danger, fontSize: 13, marginLeft: space.xs },
  card: { backgroundColor: c.surface, borderRadius: 14, padding: space.l, gap: space.m },
  toggle: { flexDirection: "row", alignItems: "center", minHeight: 48, gap: space.m },
  toggleLabel: { fontSize: 16, color: c.ink },
  hint: { fontSize: 13, color: c.muted },
  bubble: { width: 280, borderRadius: 18, padding: 14, gap: 10, backgroundColor: c.surface },
  bubbleIn: { borderBottomLeftRadius: 6 },
  bubbleOut: { borderBottomRightRadius: 6, borderWidth: 1.5, borderColor: c.outgoing },
  kicker: { fontSize: 12, fontWeight: "600", color: c.secure },
  question: { fontSize: 16, lineHeight: 22, fontWeight: "600", color: c.ink },
  opt: { minHeight: 44, borderRadius: 10, borderWidth: 1.5, borderColor: c.line, flexDirection: "row", alignItems: "center", paddingHorizontal: 12, overflow: "hidden" },
  optMine: { borderColor: c.secure },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: c.bg },
  barMine: { backgroundColor: "#CFE3DB" },
  optLabel: { flex: 1, fontSize: 14, color: c.ink, paddingVertical: 8 },
  optCount: { fontSize: 13, fontWeight: "600", color: c.ink, marginLeft: space.s },
  status: { fontSize: 12, color: c.muted },
});
