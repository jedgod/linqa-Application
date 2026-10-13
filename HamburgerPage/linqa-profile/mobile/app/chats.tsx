// Chats screen wiring for the drawer (expo-router).
// Merge into your existing Chats screen; keep your current chat list where the comment is.

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { SideDrawer } from '../components/drawer/SideDrawer';
import { DrawerMenu } from '../components/drawer/DrawerMenu';
import { ChatsHeader } from '../components/drawer/ChatsHeader';
import { PROFILE_HREF, type DrawerItem } from '../components/drawer/drawerItems';
import { useProfile } from '../hooks/useProfile';
import { avatarUri } from '../lib/profileApi';

export default function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { profile, imageHeaders } = useProfile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // TODO: use the account's display name from wherever your app already reads it.
  const displayName = 'Your Name';

  const handleSelect = useCallback(
    (item: DrawerItem) => {
      closeDrawer();
      router.push(item.href as Href);
    },
    [closeDrawer, router],
  );

  const handleProfile = useCallback(() => {
    closeDrawer();
    router.push(PROFILE_HREF as Href);
  }, [closeDrawer, router]);

  const handleLogout = useCallback(() => {
    closeDrawer();
    // Keep whatever your repo's drawer does here now (currently the remove-account screen).
    router.push('/account/manage' as Href);
  }, [closeDrawer, router]);

  return (
    <SideDrawer
      open={drawerOpen}
      onOpen={openDrawer}
      onClose={closeDrawer}
      drawerContent={
        <DrawerMenu
          user={{
            name: displayName,
            username: profile?.username ?? null,
            avatarUrl: avatarUri(profile?.avatarUrl),
            avatarHeaders: imageHeaders,
          }}
          onClose={closeDrawer}
          onSelect={handleSelect}
          onProfilePress={handleProfile}
          onLogout={handleLogout}
        />
      }
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ChatsHeader onMenuPress={openDrawer} onComposePress={() => router.push('/new-chat' as Href)} />
        {/* Your existing search bar and chat list go here. */}
      </View>
    </SideDrawer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
});
