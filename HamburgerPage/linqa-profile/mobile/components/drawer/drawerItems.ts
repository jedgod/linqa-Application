// Menu content for the Linqa side drawer.
// Edit labels, order, or routes here; DrawerMenu renders whatever this exports.
//
// If your repo's copy was trimmed (for example removed rows or changed routes),
// merge rather than overwrite: the four rows marked NEW are the ones added back.

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
import { COLORS } from '../../constants/theme';

export const DRAWER_COLORS = COLORS;

/** Where "View profile" in the drawer header goes. */
export const PROFILE_HREF = '/account/manage';

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
      { key: 'saved', label: 'Saved Messages', icon: Bookmark, href: '/saved' }, // NEW
      { key: 'archived', label: 'Archived Chats', icon: Archive, href: '/archived' },
    ],
  },
  {
    title: 'Privacy & Security',
    divider: true,
    items: [
      { key: 'linked-devices', label: 'Linked Devices', icon: MonitorSmartphone, href: '/security/devices' },
      { key: 'safety-numbers', label: 'Verify Safety Numbers', icon: ShieldCheck, href: '/security/verify' },
      { key: 'disappearing', label: 'Disappearing Messages', icon: Timer, href: '/security/disappearing' }, // NEW
      { key: 'app-lock', label: 'App Lock', icon: Lock, href: '/security/app-lock' }, // NEW
    ],
  },
  {
    divider: true,
    items: [
      { key: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
      { key: 'invite', label: 'Invite Friends', icon: UserPlus, href: '/invite' }, // NEW
      { key: 'help', label: 'Help & Feedback', icon: HelpCircle, href: '/help' },
    ],
  },
];
