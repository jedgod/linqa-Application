// Menu content for the Linqa side drawer.
// Edit labels, order, or routes here; DrawerMenu renders whatever this exports.

import {
  Archive,
  Bookmark,
  HelpCircle,
  Lock,
  MonitorSmartphone,
  Phone,
  Radio,
  Settings,
  ShieldCheck,
  Timer,
  User,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react-native';

export type DrawerItemKey =
  | 'new-group'
  | 'new-broadcast'
  | 'contacts'
  | 'calls'
  | 'saved'
  | 'archived'
  | 'linked-devices'
  | 'safety-numbers'
  | 'disappearing'
  | 'app-lock'
  | 'settings'
  | 'invite'
  | 'help';

export interface DrawerItem {
  key: DrawerItemKey;
  label: string;
  icon: LucideIcon;
  /** expo-router path to open when tapped. Change to match your app's routes. */
  href: string;
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
      { key: 'new-group', label: 'New Group', icon: Users, href: '/new-group' },
      { key: 'new-broadcast', label: 'New Broadcast', icon: Radio, href: '/new-broadcast' },
      { key: 'contacts', label: 'Contacts', icon: User, href: '/contacts' },
      { key: 'calls', label: 'Calls', icon: Phone, href: '/calls' },
      { key: 'saved', label: 'Saved Messages', icon: Bookmark, href: '/saved' },
      { key: 'archived', label: 'Archived Chats', icon: Archive, href: '/archived' },
    ],
  },
  {
    title: 'Privacy & Security',
    divider: true,
    items: [
      { key: 'linked-devices', label: 'Linked Devices', icon: MonitorSmartphone, href: '/security/devices' },
      { key: 'safety-numbers', label: 'Verify Safety Numbers', icon: ShieldCheck, href: '/security/verify' },
      { key: 'disappearing', label: 'Disappearing Messages', icon: Timer, href: '/security/disappearing' },
      { key: 'app-lock', label: 'App Lock', icon: Lock, href: '/security/app-lock' },
    ],
  },
  {
    divider: true,
    items: [
      { key: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
      { key: 'invite', label: 'Invite Friends', icon: UserPlus, href: '/invite' },
      { key: 'help', label: 'Help & Feedback', icon: HelpCircle, href: '/help' },
    ],
  },
];

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
