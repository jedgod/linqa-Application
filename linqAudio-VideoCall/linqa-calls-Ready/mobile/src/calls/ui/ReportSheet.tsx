import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import type { CallEngine } from '../CallEngine';
import { callApi } from '../callApi';
import { LIMITS, REPORT_REASONS, ReportReason } from '../protocol';
import { errorText } from '../signaling';
import { useCalls, useEngineState } from './CallProvider';
import { Button, Icon, k, Sheet, theme } from './kit';

const REASON_TEXT: Record<ReportReason, string> = {
  harassment: 'Harassment or bullying',
  spam: 'Spam or scam',
  'sexual-content': 'Sexual content',
  violence: 'Threats or violence',
  impersonation: 'Pretending to be someone else',
  other: 'Something else',
};

export function ReportSheet({
  visible,
  engine,
  onClose,
  onDone,
}: {
  visible: boolean;
  engine: CallEngine;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const s = useEngineState(engine);
  const { manager, people } = useCalls();
  const others = [...new Set(Object.values(s.peers).map((p) => p.userId))];

  const [who, setWho] = useState<string[]>([]);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [block, setBlock] = useState(false);
  const [leave, setLeave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setWho(others.length === 1 ? others : []);
    setReason(null);
    setNote('');
    setBlock(false);
    setLeave(true);
    setError(null);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (!reason || !who.length) return;
    setBusy(true);
    setError(null);
    try {
      await callApi.report(manager.session, s.callId, { reportedUserIds: who, reason, note: note.trim() || undefined });
      if (block && people.block) await Promise.all(who.map((u) => people.block!(u)));
      onClose();
      onDone(block ? 'Reported and blocked.' : 'Thanks. We got your report.');
      if (leave) await engine.hangUp();
    } catch (e: any) {
      setError(errorText(e?.code ?? ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Report" style={{ maxHeight: '92%' }}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={[k.dim, { marginBottom: 12 }]}>
          Calls are end-to-end encrypted and never recorded, so Linqa can't hear or see what happened. We'll get who was
          in the call, when, how long it lasted, and what you tell us here.
        </Text>

        {others.length > 1 ? (
          <>
            <Text style={[k.body, { fontWeight: '600', marginBottom: 4 }]}>Who are you reporting?</Text>
            {others.map((u) => {
              const on = who.includes(u);
              return (
                <Pressable
                  key={u}
                  style={k.listRow}
                  onPress={() => setWho((cur) => (on ? cur.filter((x) => x !== u) : [...cur, u]))}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Text style={[k.body, { flex: 1 }]}>{people.displayName(u)}</Text>
                  <Icon name={on ? 'check-square' : 'square'} color={on ? theme.accent : theme.textDim} />
                </Pressable>
              );
            })}
            <View style={{ height: 16 }} />
          </>
        ) : null}

        <Text style={[k.body, { fontWeight: '600', marginBottom: 4 }]}>What happened?</Text>
        {REPORT_REASONS.map((r) => (
          <Pressable
            key={r}
            style={k.listRow}
            onPress={() => setReason(r)}
            accessibilityRole="radio"
            accessibilityState={{ checked: reason === r }}
          >
            <Text style={[k.body, { flex: 1 }]}>{REASON_TEXT[r]}</Text>
            <Icon name={reason === r ? 'disc' : 'circle'} color={reason === r ? theme.accent : theme.textDim} />
          </Pressable>
        ))}

        <TextInput
          value={note}
          onChangeText={(t) => setNote(t.slice(0, LIMITS.reportNoteMax))}
          placeholder="Add details (optional)"
          placeholderTextColor={theme.textDim}
          multiline
          style={{
            backgroundColor: theme.surfaceHi,
            color: theme.text,
            borderRadius: 12,
            padding: 12,
            minHeight: 88,
            textAlignVertical: 'top',
            fontSize: 15,
            marginTop: 14,
          }}
          accessibilityLabel="Details"
        />
        <Text style={[k.dim, { alignSelf: 'flex-end', marginTop: 4 }]}>
          {note.length}/{LIMITS.reportNoteMax}
        </Text>

        {people.block ? (
          <View style={[k.listRow, { borderBottomWidth: 0 }]}>
            <Text style={[k.body, { flex: 1 }]}>Also block {who.length === 1 ? people.displayName(who[0]) : 'them'}</Text>
            <Switch value={block} onValueChange={setBlock} accessibilityLabel="Also block" />
          </View>
        ) : null}
        <View style={[k.listRow, { borderBottomWidth: 0 }]}>
          <Text style={[k.body, { flex: 1 }]}>Leave the call after reporting</Text>
          <Switch value={leave} onValueChange={setLeave} accessibilityLabel="Leave the call after reporting" />
        </View>

        {error ? <Text style={{ color: theme.danger, marginVertical: 8 }}>{error}</Text> : null}
        <Button
          label="Send report"
          kind="danger"
          disabled={!reason || !who.length}
          busy={busy}
          onPress={submit}
          style={{ marginTop: 12 }}
        />
      </ScrollView>
    </Sheet>
  );
}
