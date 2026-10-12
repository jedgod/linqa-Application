import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useCalls } from './CallProvider';
import { Button, Icon, k, Sheet, theme } from './kit';

interface Person {
  userId: string;
  name: string;
}

/** Pick who to add. The confirm with their names is shown by CallScreen after this. */
export function AddPersonSheet({
  visible,
  excludeUserIds,
  maxNew,
  onClose,
  onPicked,
}: {
  visible: boolean;
  excludeUserIds: string[];
  maxNew: number;
  onClose: () => void;
  onPicked: (people: Person[]) => void;
}) {
  const { people } = useCalls();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Person[]>([]);

  useEffect(() => {
    if (!visible) {
      setQ('');
      setPicked([]);
      return;
    }
    let live = true;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await people.addableContacts(q.trim());
        if (live) setResults(r.filter((p) => !excludeUserIds.includes(p.userId)));
      } catch { if (live) setResults([]); } finally {
        if (live) setLoading(false);
      }
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (p: Person) =>
    setPicked((cur) =>
      cur.some((x) => x.userId === p.userId)
        ? cur.filter((x) => x.userId !== p.userId)
        : cur.length < maxNew
          ? [...cur, p]
          : cur,
    );

  return (
    <Sheet visible={visible} onClose={onClose} title="Add person" style={{ minHeight: '60%' }}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search contacts"
        placeholderTextColor={theme.textDim}
        style={{
          backgroundColor: theme.surfaceHi,
          color: theme.text,
          borderRadius: 12,
          paddingHorizontal: 14,
          minHeight: 46,
          fontSize: 16,
          marginBottom: 8,
        }}
        autoFocus
        accessibilityLabel="Search contacts"
      />
      <Text style={[k.dim, { marginBottom: 6 }]}>
        {maxNew > 0 ? `You can add ${maxNew} more.` : 'This call is full.'}
      </Text>
      {loading ? <ActivityIndicator color={theme.textDim} style={{ marginVertical: 12 }} /> : null}
      <FlatList
        data={results}
        keyExtractor={(p) => p.userId}
        style={{ flexGrow: 0, maxHeight: 360 }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={!loading ? <Text style={[k.dim, { paddingVertical: 16 }]}>No contacts found.</Text> : null}
        renderItem={({ item }) => {
          const on = picked.some((x) => x.userId === item.userId);
          return (
            <Pressable
              style={k.listRow}
              onPress={() => toggle(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
            >
              <Text style={[k.body, { flex: 1 }]}>{item.name}</Text>
              <Icon name={on ? 'check-circle' : 'circle'} color={on ? theme.accent : theme.textDim} />
            </Pressable>
          );
        }}
      />
      <View style={{ marginTop: 12 }}>
        <Button
          label={picked.length ? `Add ${picked.length === 1 ? picked[0].name : `${picked.length} people`}` : 'Add'}
          disabled={!picked.length}
          onPress={() => onPicked(picked)}
        />
      </View>
    </Sheet>
  );
}
