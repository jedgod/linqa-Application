import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { usePathname, router } from 'expo-router';
import { breadcrumbsForPath, navigationMode, routes } from './navigation';

const C = { bg: '#121214', surface: '#1C2328', text: '#FFFFFF', muted: '#B9C7CC', teal: '#42E1CE' };

export function AdaptiveNavigation({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const mode = navigationMode(width);
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const chain = breadcrumbsForPath(pathname);
  const isMobile = mode === 'mobile';
  const compact = mode === 'tablet-compact';
  const showSidebar = !isMobile && (!compact || drawerOpen);
  const visibleCrumbs = compact && chain.length > 3 ? [chain[0], ...chain.slice(-2)] : chain;

  const go = (href: string) => { setDrawerOpen(false); router.push(href as any); };
  const links = (items: typeof routes) => items.map(route => (
    <Pressable key={route.id} accessibilityRole="link" accessibilityLabel={`Open ${route.label}`}
      onPress={() => go(route.href)}
      style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9,
        backgroundColor: pathname === route.href ? '#11554F' : 'transparent' }}>
      <Text style={{ color: pathname === route.href ? C.teal : C.text }}>{route.label}</Text>
    </Pressable>
  ));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {showSidebar && (
          <ScrollView accessibilityLabel="Linqa navigation" style={{ width: compact ? 180 : 240, flexGrow: 0, backgroundColor: C.surface }}>
            <Text style={{ color: C.teal, fontWeight: '700', fontSize: 20, margin: 16 }}>LINQA</Text>
            {links(routes.filter(route => route.sidebar))}
          </ScrollView>
        )}
        <View style={{ flex: 1 }}>
          {!isMobile && (
            <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, flexWrap: 'wrap' }}>
              {compact && <Pressable accessibilityRole="button" accessibilityLabel={drawerOpen ? 'Close navigation' : 'Open navigation'}
                onPress={() => setDrawerOpen(value => !value)} style={{ minHeight: 44, justifyContent: 'center', paddingRight: 16 }}>
                <Text style={{ color: C.teal }}>☰</Text>
              </Pressable>}
              {visibleCrumbs.map((crumb, index) => (
                <React.Fragment key={crumb.id}>
                  {index > 0 && <Text style={{ color: C.muted }}>  ›  </Text>}
                  <Pressable accessibilityRole="link" accessibilityLabel={`Navigate to ${crumb.label}`}
                    disabled={index === visibleCrumbs.length - 1}
                    onPress={() => go(crumb.href)} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <Text style={{ color: index === visibleCrumbs.length - 1 ? C.teal : C.muted }}>{crumb.label}</Text>
                  </Pressable>
                </React.Fragment>
              ))}
            </View>
          )}
          <View style={{ flex: 1 }}>{children}</View>
        </View>
      </View>
      {isMobile && (
        <View accessibilityLabel="Primary tabs" style={{ flexDirection: 'row', backgroundColor: C.surface, justifyContent: 'space-around' }}>
          {routes.filter(route => route.mobileTab).map(route => (
            <Pressable key={route.id} accessibilityRole="tab" accessibilityState={{ selected: pathname === route.href }}
              onPress={() => go(route.href)} style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: 8 }}>
              <Text style={{ color: pathname === route.href ? C.teal : C.muted, fontSize: 12 }}>{route.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}
