// EXAMPLE ONLY: shows where <ProfileEditor /> goes in your existing
// app/account/manage.tsx. Copy the import and the <ProfileEditor> line into
// your real file; do not add this file to the app as-is.

import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { ProfileEditor } from '../../components/account/ProfileEditor';
import { COLORS } from '../../constants/theme';

export default function ManageAccountScreen() {
  // TODO: the account's display name, from wherever this screen already reads it.
  const displayName = 'Your Name';

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Account' }} />

      {/* NEW: avatar + @username, above everything else on this screen */}
      <ProfileEditor name={displayName} />

      {/* ...your existing account options (including remove account) stay below... */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: 16, gap: 16 },
});
