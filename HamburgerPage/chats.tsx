// Example: wiring the drawer into the Linqa Chats screen (expo-router).
// Merge this into your existing Chats screen file; keep your current chat list
// where the placeholder comment is.

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import { SideDrawer } from '../components/drawer/SideDrawer';
import { DrawerMenu, type DrawerUser } from '../components/drawer/DrawerMenu';
import { ChatsHeader } from '../components/drawer/ChatsHeader';
import type { DrawerItem } from '../components/drawer/drawerItems';

export default function ChatsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // TODO: replace with the signed-in user from your auth state.
  const user: DrawerUser = { name: 'Your Name', username: 'username', avatarUrl: null };

  // Tapping a row closes the drawer and opens that screen at the same time.
  const handleSelect = useCallback(
    (item: DrawerItem) => {
      closeDrawer();
      router.push(item.href as Href);
    },
    [closeDrawer, router]
  );

  const handleProfile = useCallback(() => {
    closeDrawer();
    router.push('/profile' as Href);
  }, [closeDrawer, router]);

  const handleLogout = useCallback(async () => {
    closeDrawer();
    // TODO: call your logout here, for example:
    //   await SecureStore.deleteItemAsync('linqa_jwt');
    //   await clearLocalSession();   // decide what happens to linqa-core keys
    router.replace('/login' as Href);
  }, [closeDrawer, router]);

  return (
    <SideDrawer
      open={drawerOpen}
      onOpen={openDrawer}
      onClose={closeDrawer}
      drawerContent={
        <DrawerMenu
          user={user}
          onClose={closeDrawer}
          onSelect={handleSelect}
          onProfilePress={handleProfile}
          onLogout={handleLogout}
        />
      }
    >
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <ChatsHeader
          onMenuPress={openDrawer}
          onComposePress={() => router.push('/new-chat' as Href)}
        />

        {/* Your existing search bar and chat list go here. */}
      </View>
    </SideDrawer>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
});
