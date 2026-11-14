// التبويبات الأربعة (docs/design/README.md): ارتفاع 72، بترتيب الإعلان، وفي RTL يبدأ "الرئيسية" من اليمين.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { ar } from '../../i18n/ar';
import { colors, fonts, sizes } from '../../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; title: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', title: ar.tabs.home, icon: 'home-outline', iconActive: 'home' },
  { name: 'cart', title: ar.tabs.cart, icon: 'cart-outline', iconActive: 'cart' },
  { name: 'orders', title: ar.tabs.orders, icon: 'receipt-outline', iconActive: 'receipt' },
  { name: 'account', title: ar.tabs.account, icon: 'person-outline', iconActive: 'person' },
];

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          height: sizes.tabBar,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingTop: 6,
          paddingBottom: 10,
        },
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 12 },
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{
            title: t.title,
            tabBarAccessibilityLabel: t.title,
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? t.iconActive : t.icon} size={size} color={String(color)} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
