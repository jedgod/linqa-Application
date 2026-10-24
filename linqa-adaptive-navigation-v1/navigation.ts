export type NavRoute = {
  id: string;
  label: string;
  href: string;
  parentId?: string;
  sidebar?: boolean;
  mobileTab?: boolean;
};

// Illustrative hrefs: verify against the real Expo Router filesystem.
export const routes: NavRoute[] = [
  { id: 'home', label: 'Home', href: '/', sidebar: true, mobileTab: true },
  { id: 'chats', label: 'Chats', href: '/chats', parentId: 'home', sidebar: true, mobileTab: true },
  { id: 'calls', label: 'Calls', href: '/calls', parentId: 'home', sidebar: true, mobileTab: true },
  { id: 'country', label: 'CountryLinqa', href: '/countrylinqa', parentId: 'home', sidebar: true },
  { id: 'send', label: 'LinqaSend', href: '/send', parentId: 'home', sidebar: true, mobileTab: true },
  { id: 'wallet', label: 'Wallet', href: '/send/wallet', parentId: 'send' },
  { id: 'transactions', label: 'Transactions', href: '/send/transactions', parentId: 'wallet' },
  { id: 'vault', label: 'LinqaVault', href: '/vault', parentId: 'home', sidebar: true },
  { id: 'airfly', label: 'Airfly', href: '/airfly', parentId: 'home', sidebar: true },
  { id: 'settings', label: 'Settings', href: '/settings', parentId: 'home', sidebar: true, mobileTab: true },
];

const normalize = (path: string) => {
  const clean = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return clean;
};

export function breadcrumbsForPath(pathname: string): NavRoute[] {
  const byId = new Map(routes.map(route => [route.id, route]));
  const current = routes.find(route => normalize(route.href) === normalize(pathname));
  if (!current) return [];
  const chain: NavRoute[] = [];
  const seen = new Set<string>();
  let node: NavRoute | undefined = current;
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    chain.unshift(node);
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return chain;
}

export function navigationMode(width: number): 'mobile' | 'tablet-compact' | 'tablet-expanded' | 'desktop' {
  if (width < 600) return 'mobile';
  if (width < 840) return 'tablet-compact';
  if (width < 1200) return 'tablet-expanded';
  return 'desktop';
}
