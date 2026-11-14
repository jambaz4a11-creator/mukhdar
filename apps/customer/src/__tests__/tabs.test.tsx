// RNTL (T09): التبويبات الأربعة تُعرض بالعربية، والرئيسية هي الافتراضية.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderRouter, screen } from 'expo-router/testing-library';
import type { ReactNode } from 'react';
import TabLayout from '../app/(tabs)/_layout';
import AccountScreen from '../app/(tabs)/account';
import CartScreen from '../app/(tabs)/cart';
import HomeScreen from '../app/(tabs)/index';
import OrdersScreen from '../app/(tabs)/orders';
import { ar } from '../i18n/ar';

jest.mock('../lib/supabase', () => ({ getSupabase: () => null }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('tabs', () => {
  it('shows the four tabs in Arabic, Home first', async () => {
    await renderRouter(
      {
        '(tabs)/_layout': TabLayout,
        '(tabs)/index': HomeScreen,
        '(tabs)/cart': CartScreen,
        '(tabs)/orders': OrdersScreen,
        '(tabs)/account': AccountScreen,
      },
      { initialUrl: '/', wrapper },
    );

    for (const label of [ar.tabs.home, ar.tabs.cart, ar.tabs.orders, ar.tabs.account]) {
      expect(await screen.findByLabelText(label)).toBeTruthy();
    }
    expect(screen).toHavePathname('/');
    // بدون .env: رسالة واضحة بدل الانهيار
    expect(screen.getByText(ar.home.notConfigured)).toBeTruthy();
  });
});
