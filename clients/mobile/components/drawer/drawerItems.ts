// Menu content for the Chats side drawer.
// Edit labels, order, or routes here; DrawerMenu renders whatever this exports.
// An item either opens a route (`href`) or is handled by the Chats screen (`action`).

import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export type DrawerIcon = ComponentProps<typeof Ionicons>['name'];

export type DrawerItemKey =
  | 'new-group'
  | 'new-broadcast'
  | 'contacts'
  | 'calls'
  | 'archived'
  | 'send'
  | 'wallet'
  | 'business'
  | 'vault'
  | 'countrylinqa'
  | 'linked-devices'
  | 'safety-numbers'
  | 'settings'
  | 'help';

export interface DrawerItem {
  key: DrawerItemKey;
  label: string;
  icon: DrawerIcon;
  /** expo-router path to open when tapped. */
  href?: string;
  /** Handled in place by the Chats screen instead of navigating. */
  action?: 'new-group' | 'archived';
}

export interface DrawerSection {
  /** Optional small uppercase heading above the section. */
  title?: string;
  /** Draw a divider line above this section. */
  divider?: boolean;
  items: DrawerItem[];
}

export const DRAWER_SECTIONS: DrawerSection[] = [
  {
    items: [
      { key: 'new-group', label: 'New Group', icon: 'people-outline', action: 'new-group' },
      { key: 'new-broadcast', label: 'New Broadcast', icon: 'radio-outline', href: '/modules/status' },
      { key: 'contacts', label: 'Contacts', icon: 'person-outline', href: '/connections' },
      { key: 'calls', label: 'Calls', icon: 'call-outline', href: '/(tabs)/calls' },
      { key: 'archived', label: 'Archived Chats', icon: 'archive-outline', action: 'archived' },
    ],
  },
  {
    title: 'Money & Business',
    divider: true,
    items: [
      { key: 'send', label: 'Linqa Send', icon: 'paper-plane-outline', href: '/linqasend' },
      { key: 'wallet', label: 'Wallet', icon: 'wallet-outline', href: '/modules/wallet' },
      { key: 'business', label: 'Business', icon: 'business-outline', href: '/modules/enterprise' },
    ],
  },
  {
    title: 'Discover',
    divider: true,
    items: [
      { key: 'vault', label: 'Linqa Vault', icon: 'lock-closed-outline', href: '/modules/file-vault' },
      { key: 'countrylinqa', label: 'Country Linqa™', icon: 'globe-outline', href: '/countrylinqa/world' },
    ],
  },
  {
    title: 'Privacy & Security',
    divider: true,
    items: [
      { key: 'linked-devices', label: 'Linked Devices', icon: 'laptop-outline', href: '/linked-devices' },
      { key: 'safety-numbers', label: 'Verify Safety Numbers', icon: 'shield-checkmark-outline', href: '/security/key-transparency' },
    ],
  },
  {
    divider: true,
    items: [
      { key: 'settings', label: 'Settings', icon: 'settings-outline', href: '/(tabs)/settings' },
      { key: 'help', label: 'Help & Feedback', icon: 'help-circle-outline', href: '/support' },
    ],
  },
];

/** Version label shown at the bottom of the drawer. */
export const DRAWER_VERSION = '1.3.0';

export const DRAWER_COLORS = {
  headerBg: '#0F1B3D',
  headerText: '#FFFFFF',
  headerSubtext: '#C5CEE6',
  avatarBg: '#3D6BF0',
  closeBtnBg: 'rgba(255,255,255,0.08)',
  surface: '#FFFFFF',
  text: '#151A26',
  muted: '#5B6478',
  divider: '#E6E9F0',
  pressed: '#F1F3F8',
  danger: '#B42318',
  overlay: 'rgba(12,16,28,0.48)',
};
