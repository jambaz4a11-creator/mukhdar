// شاشة اليوم (التصميم Today): بطاقتا الكاش والعدد، القائمة، ملاحظة التصفير.
import { screen } from '@testing-library/react-native';
import TodayScreen from '../app/(tabs)/today';
import { useAuth } from '../features/auth/store';
import { createFakeSupabase } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (cb: () => (() => void) | undefined) => useEffect(cb, [cb]) };
});

beforeEach(() => {
  useAuth.setState({ ready: true, session: { user: { id: 'me' } } as never });
});

it('shows cash, count and the list', async () => {
  const rows = [
    {
      id: 'a',
      order_number: 1043,
      total_iqd: 9000,
      delivered_at: '2026-11-19T07:21:00Z',
      address_snapshot: { subsection: 'A3', building: '14' },
    },
    {
      id: 'b',
      order_number: 1039,
      total_iqd: 65000,
      delivered_at: '2026-11-19T06:50:00Z',
      address_snapshot: { subsection: 'B1', building: '12' },
    },
  ];
  mockClient = createFakeSupabase(() => ({ data: rows, error: null })).client;
  await renderScreen(<TodayScreen />);
  expect(await screen.findByText('#1043 · بلوك A3 · بناية 14')).toBeTruthy();
  expect(screen.getByTestId('today-cash')).toHaveTextContent('74,000', { exact: false });
  expect(screen.getByTestId('today-count')).toHaveTextContent('2', { exact: false });
  expect(screen.getByText('10:21 ص')).toBeTruthy();
  expect(screen.getByText('9,000')).toBeTruthy();
  expect(screen.getByText(/تتصفّر كل يوم/)).toBeTruthy();
});

it('empty day: zeros and an empty message', async () => {
  mockClient = createFakeSupabase(() => ({ data: [], error: null })).client;
  await renderScreen(<TodayScreen />);
  expect(await screen.findByTestId('today-empty')).toBeTruthy();
  expect(screen.getByTestId('today-cash')).toHaveTextContent('0', { exact: false });
});
