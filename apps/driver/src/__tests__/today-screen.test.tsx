// شاشة اليوم (SPEC-cash §5، يحل محل SPEC-driver §2.9): "الكاش اللي بيدك" من driver_cash_summary منذ آخر تسليم، وقائمة
// الطلبات التي فلوسها بيد السائق، وتوصيلات اليوم، ورابط سجل التسليمات، والتحديث (إشعار cash_handover، سحب).
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import TodayScreen from '../app/(tabs)/today';
import { useAuth } from '../features/auth/store';
import { emitNotification } from '../features/notifications/events';
import { ar } from '../i18n/ar';
import { createFakeSupabase, type Call } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
const mockPush = jest.fn();
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (cb: () => (() => void) | undefined) => useEffect(cb, [cb]),
    router: { push: (...a: unknown[]) => mockPush(...a) },
  };
});

const SUMMARY = {
  outstanding_iqd: 80000,
  order_count: 2,
  oldest_delivered_at: '2026-11-19T06:50:00Z',
  last_handover_at: '2026-11-18T15:30:00Z',
  last_received_iqd: 20000,
  last_difference_iqd: 0,
  includes_delivery_fee: true,
};
const IN_HAND = [
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

interface Setup {
  summary?: Record<string, unknown> | 'error';
  inHand?: unknown[];
  today?: unknown[];
}

function setup(s: Setup = {}) {
  const fake = createFakeSupabase((call: Call) => {
    if (call.table === 'rpc:driver_cash_summary') {
      if (s.summary === 'error') {
        return { data: null, error: { message: 'Network request failed' } };
      }
      return { data: [{ ...SUMMARY, ...s.summary }], error: null };
    }
    if (call.table === 'orders') {
      // قائمة "بيدك" تحمل is(cash_handover_id, null)؛ توصيلات اليوم تحمل gte(delivered_at)
      const inHand = call.ops.some(([n]) => n === 'is');
      return { data: inHand ? (s.inHand ?? IN_HAND) : (s.today ?? IN_HAND), error: null };
    }
    return { data: [], error: null };
  });
  mockClient = fake.client;
  return fake;
}

const summaryCalls = (fake: ReturnType<typeof setup>) =>
  fake.calls.filter((c) => c.table === 'rpc:driver_cash_summary').length;

beforeEach(() => {
  mockPush.mockClear();
  useAuth.setState({ ready: true, session: { user: { id: 'me' } } as never });
});

it('the card shows the FUNCTION value (not the sum of the list), with count and the last handover', async () => {
  setup(); // الدالة 80,000 بينما مجموع القائمة 74,000
  await renderScreen(<TodayScreen />);
  expect(await screen.findByText('#1043 · بلوك A3 · بناية 14')).toBeTruthy();
  const card = screen.getByTestId('today-cash');
  expect(card).toHaveTextContent('80,000', { exact: false });
  expect(card).not.toHaveTextContent('74,000', { exact: false });
  expect(card).toHaveTextContent(ar.today.cash, { exact: false });
  expect(screen.getByTestId('today-cash-since')).toHaveTextContent(
    'عن 2 طلب · من آخر تسليم 18 تشرين الثاني · 6:30 م',
  );
  expect(screen.getByText('10:21 ص')).toBeTruthy();
  expect(screen.getByText('9,000')).toBeTruthy();
  expect(screen.queryByTestId('today-fee-note')).toBeNull();
});

it('never handed over: "ما سلّمت كاش بعد"', async () => {
  setup({ summary: { last_handover_at: null, last_received_iqd: null } });
  await renderScreen(<TodayScreen />);
  expect(await screen.findByText(/ما سلّمت كاش بعد/)).toBeTruthy();
  expect(screen.queryByText(/من آخر تسليم/)).toBeNull();
});

it('zero balance after a handover (the card empties at the handover, not at midnight)', async () => {
  setup({
    summary: { outstanding_iqd: 0, order_count: 0, oldest_delivered_at: null },
    inHand: [],
    today: IN_HAND,
  });
  await renderScreen(<TodayScreen />);
  expect(await screen.findByTestId('today-empty')).toBeTruthy();
  expect(screen.getByTestId('today-cash')).not.toHaveTextContent('80,000', { exact: false });
  expect(screen.getByTestId('today-cash')).toHaveTextContent('0', { exact: false });
  // توصيلات اليوم مستقلة عن الرصيد: ما زالت 2
  expect(screen.getByTestId('today-count')).toHaveTextContent('2', { exact: false });
});

it('delivery fee stays with the driver: the label changes and the fee note appears', async () => {
  setup({ summary: { includes_delivery_fee: false } });
  await renderScreen(<TodayScreen />);
  await screen.findByTestId('today-fee-note');
  expect(screen.getByTestId('today-cash')).toHaveTextContent(ar.today.cashGoodsOnly, {
    exact: false,
  });
  expect(screen.getByTestId('today-fee-note')).toHaveTextContent(ar.today.feeStays);
});

it('the note says the cash resets at handover (no midnight reset)', async () => {
  setup();
  await renderScreen(<TodayScreen />);
  expect(await screen.findByText(/الكاش يتصفّر لما تسلّمه للمحل/)).toBeTruthy();
  expect(screen.queryByText(/12 بالليل/)).toBeNull();
});

it('today count = today delivered orders; the in-hand list is separate', async () => {
  setup({ today: [IN_HAND[0]] });
  await renderScreen(<TodayScreen />);
  await screen.findByText('#1039 · بلوك B1 · بناية 12');
  expect(screen.getByTestId('today-count')).toHaveTextContent('1', { exact: false });
});

it('a summary error shows the error and never a fake zero balance', async () => {
  setup({ summary: 'error' });
  await renderScreen(<TodayScreen />);
  expect(await screen.findByTestId('today-error')).toBeTruthy();
  expect(screen.getByTestId('today-cash')).not.toHaveTextContent('0', { exact: false });
});

it('the "سجل التسليمات" link opens the history screen', async () => {
  setup();
  await renderScreen(<TodayScreen />);
  await fireEvent.press(await screen.findByTestId('today-history-link'));
  expect(mockPush).toHaveBeenCalledWith('/cash/history');
});

it('a cash_handover notification while open refreshes the card; other types do not', async () => {
  const fake = setup();
  await renderScreen(<TodayScreen />);
  await screen.findByText('#1043 · بلوك A3 · بناية 14');
  const before = summaryCalls(fake);
  await act(async () => emitNotification({ type: 'ready' }));
  expect(summaryCalls(fake)).toBe(before);
  await act(async () => emitNotification({ type: 'cash_handover', handover_id: 'x' }));
  await waitFor(() => expect(summaryCalls(fake)).toBe(before + 1));
});

it('pull to refresh reloads', async () => {
  const fake = setup();
  await renderScreen(<TodayScreen />);
  await screen.findByText('#1043 · بلوك A3 · بناية 14');
  const before = summaryCalls(fake);
  await act(async () => {
    await screen.getByTestId('today-scroll').props.refreshControl.props.onRefresh();
  });
  expect(summaryCalls(fake)).toBe(before + 1);
});

it('R2 L3: an empty list re-checks the profile (a just-deactivated driver reads zero rows under RLS)', async () => {
  const fake = setup({ inHand: [], today: [] });
  await renderScreen(<TodayScreen />);
  await screen.findByTestId('today-empty');
  await waitFor(() => expect(fake.calls.some((c) => c.table === 'profiles')).toBe(true));
});
