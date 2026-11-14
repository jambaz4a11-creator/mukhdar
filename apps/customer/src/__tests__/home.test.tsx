// الرئيسية تقرأ app_settings (اختبار الاتصال)، والخطأ يظهر برسالة عربية مع إعادة المحاولة.
import { formatIQD } from '@mukhdar/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react-native';
import HomeScreen from '../app/(tabs)/index';
import { ar } from '../i18n/ar';

const mockSingle = jest.fn();
const mockFrom = jest.fn(() => ({ select: () => ({ limit: () => ({ single: mockSingle }) }) }));
jest.mock('../lib/supabase', () => ({ getSupabase: () => ({ from: mockFrom }) }));
const single = mockSingle;
const from = mockFrom;

async function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return await render(
    <QueryClientProvider client={client}>
      <HomeScreen />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  single.mockReset();
  from.mockClear();
});

describe('home: app_settings', () => {
  it('shows the store status, delivery fee and minimum order from Supabase', async () => {
    single.mockResolvedValue({
      data: { store_open: true, closed_message: null, delivery_fee_iqd: 1000, min_order_iqd: 5000 },
      error: null,
    });
    await renderHome();
    expect(await screen.findByText(ar.home.storeOpen)).toBeTruthy();
    expect(screen.getByText(formatIQD(1000))).toBeTruthy();
    expect(screen.getByText(formatIQD(5000))).toBeTruthy();
    expect(from).toHaveBeenCalledWith('app_settings');
  });

  it('shows the closed message when the store is closed', async () => {
    single.mockResolvedValue({
      data: {
        store_open: false,
        closed_message: 'مغلق للجرد',
        delivery_fee_iqd: 1000,
        min_order_iqd: 0,
      },
      error: null,
    });
    await renderHome();
    expect(await screen.findByText('مغلق للجرد')).toBeTruthy();
    expect(screen.getByText(ar.home.noMinOrder)).toBeTruthy();
  });

  it('shows an Arabic error with a retry button (never the raw error)', async () => {
    single.mockResolvedValue({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    });
    await renderHome();
    expect(await screen.findByText(ar.home.retry)).toBeTruthy();
    expect(screen.queryByText('permission denied')).toBeNull();
  });
});
