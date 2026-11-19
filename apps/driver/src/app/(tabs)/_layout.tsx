// التبويبات الأربعة (التصميم المعتمد: الجاهزة، طلباتي، اليوم، حسابي). ارتفاع 72، وفي RTL تبدأ "الجاهزة" من اليمين.
// المحتوى بـ T31/T32؛ هنا الهياكل فقط.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { ar } from '../../i18n/ar';
import { colors, fonts, sizes } from '../../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const TABS: { name: string; title: string; icon: IconName; iconActive: IconName }[] = [
  { name: 'index', title: ar.tabs.ready, icon: 'cube-outline', iconActive: 'cube' },
  { name: 'my-orders', title: ar.tabs.mine, icon: 'bicycle-outline', iconActive: 'bicycle' },
  { name: 'today', title: ar.tabs.today, icon: 'calendar-outline', iconActive: 'calendar' },
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
