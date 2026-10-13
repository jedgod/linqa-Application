// Disappearing Messages: the default timer for new chats on this device.

import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Stack } from 'expo-router';
import { COLORS } from '../../constants/theme';
import { OptionRow, Section } from '../../components/ui/Rows';
import { useLocalSettings } from '../../lib/localSettings';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

export const DISAPPEARING_OPTIONS: { label: string; seconds: number }[] = [
  { label: 'Off', seconds: 0 },
  { label: '1 hour', seconds: HOUR },
  { label: '8 hours', seconds: 8 * HOUR },
  { label: '1 day', seconds: DAY },
  { label: '1 week', seconds: 7 * DAY },
  { label: '4 weeks', seconds: 28 * DAY },
];

export default function DisappearingMessagesScreen() {
  const { settings, loaded, update } = useLocalSettings();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Disappearing Messages' }} />

      <Section
        title="Default timer for new chats"
        footer="New chats you start will delete messages for everyone after this time. Existing chats keep their own setting, which you can change inside each chat."
      >
        {DISAPPEARING_OPTIONS.map((opt, i) => (
          <OptionRow
            key={opt.seconds}
            label={opt.label}
            selected={settings.disappearingDefaultSec === opt.seconds}
            onPress={() => void update({ disappearingDefaultSec: opt.seconds })}
            disabled={!loaded}
            last={i === DISAPPEARING_OPTIONS.length - 1}
          />
        ))}
      </Section>

      <Text style={styles.note}>
        Someone can still screenshot or copy a message before it disappears.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, gap: 20 },
  note: { paddingHorizontal: 4, fontSize: 13, lineHeight: 18, color: COLORS.muted },
});
