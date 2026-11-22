// سجل التسليمات (SPEC-cash §5): الوقت، المستلم، المطلوب إن اختلف، شارة نقص/زيادة، الملاحظة (نص صرف)، المستلِم، "تعدّل".
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import CashHistoryScreen from '../app/cash/history';
import { useAuth } from '../features/auth/store';
import { emitNotification } from '../features/notifications/events';
import { createFakeSupabase, opArgs, type Call } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (cb: () => (() => void) | undefined) => useEffect(cb, [cb]),
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  };
});

const base = {
  order_count: 3,
  includes_delivery_fee: true,
  note: null,
  recorded_by_name: 'سعد',
  corrected_at: null,
};
const MATCH = {
  ...base,
  id: 'h1',
  recorded_at: '2026-11-19T07:21:00Z',
  expected_iqd: 10000,
  received_iqd: 10000,
  difference_iqd: 0,
};
const SHORT = {
  ...base,
  id: 'h2',
  recorded_at: '2026-11-18T15:30:00Z',
  expected_iqd: 10000,
  received_iqd: 9750,
  difference_iqd: -250,
  note: 'ناقصت <b>ربع</b> بالباقي',
  corrected_at: '2026-11-18T16:00:00Z',
};
const OVER = {
  ...base,
  id: 'h3',
  recorded_at: '2026-11-17T09:00:00Z',
  expected_iqd: 10000,
  received_iqd: 10500,
  difference_iqd: 500,
  note: 'زيادة من الزبون',
  recorded_by_name: null,
};

function setup(pages: unknown[][]) {
  let n = 0;
  const fake = createFakeSupabase((call: Call) => {
    if (call.table === 'rpc:my_cash_handovers') return { data: pages[n++] ?? [], error: null };
    return { data: [], error: null };
  });
  mockClient = fake.client;
  return fake;
}

const historyCalls = (fake: ReturnType<typeof setup>) =>
  fake.calls.filter((c) => c.table === 'rpc:my_cash_handovers');

beforeEach(() => useAuth.setState({ ready: true, session: { user: { id: 'me' } } as never }));

it('rows: time, received, badges, plain-text note, receiver, corrected', async () => {
  setup([[MATCH, SHORT, OVER]]);
  await renderScreen(<CashHistoryScreen />);
  await screen.findByTestId('history-row-h1');

  // مطابق: لا شارة ولا "المطلوب"
  const r1 = screen.getByTestId('history-row-h1');
  expect(r1).toHaveTextContent('استلم المحل 10,000 د.ع', { exact: false });
  expect(r1).toHaveTextContent('19 تشرين الثاني · 10:21 ص', { exact: false });
  expect(r1).toHaveTextContent('استلمها سعد', { exact: false });
  expect(r1).not.toHaveTextContent('المطلوب', { exact: false });
  expect(screen.queryByTestId('history-badge-h1')).toBeNull();

  // نقص + ملاحظة كنص صرف + "تعدّل"
  const r2 = screen.getByTestId('history-row-h2');
  expect(r2).toHaveTextContent('استلم المحل 9,750 د.ع', { exact: false });
  expect(r2).toHaveTextContent('المطلوب 10,000 د.ع', { exact: false });
  expect(screen.getByTestId('history-badge-h2')).toHaveTextContent('نقص 250 د.ع', { exact: false });
  expect(r2).toHaveTextContent('ناقصت <b>ربع</b> بالباقي', { exact: false });
  expect(r2).toHaveTextContent('تعدّل', { exact: false });

  // زيادة، والمستلِم المحذوف لا يُعرض اسمه
  const r3 = screen.getByTestId('history-row-h3');
  expect(screen.getByTestId('history-badge-h3')).toHaveTextContent('زيادة 500 د.ع', {
    exact: false,
  });
  expect(r3).not.toHaveTextContent('استلمها', { exact: false });
  expect(r3).not.toHaveTextContent('تعدّل', { exact: false });
});

it('empty: "ما عندك تسليمات بعد"', async () => {
  setup([[]]);
  await renderScreen(<CashHistoryScreen />);
  expect(await screen.findByTestId('history-empty')).toHaveTextContent('ما عندك تسليمات بعد');
});

it('paging by scrolling: the next page uses the last row as the cursor and appends', async () => {
  const full = Array.from({ length: 20 }, (_, i) => ({
    ...MATCH,
    id: `p${i}`,
    recorded_at: `2026-11-${String(20 - (i % 19)).padStart(2, '0')}T08:00:00Z`,
  }));
  const fake = setup([full, [{ ...MATCH, id: 'last' }]]);
  await renderScreen(<CashHistoryScreen />);
  await screen.findByTestId('history-row-p0');
  await act(async () => {
    fireEvent(screen.getByTestId('history-list'), 'endReached');
  });
  await waitFor(() => expect(historyCalls(fake)).toHaveLength(2));
  // أُضيفت للقائمة ولم تستبدلها (الـ FlatList المحاكى يقطّع العرض فلا نبحث عن الصف الجديد نفسه)
  expect(screen.getByTestId('history-row-p0')).toBeTruthy();
  expect(historyCalls(fake)).toHaveLength(2);
  expect(opArgs(historyCalls(fake)[1] as Call, 'rpc')).toEqual([
    { p_limit: 20, p_before_at: full[19]?.recorded_at, p_before_id: 'p19' },
  ]);
  // الصفحة الأخيرة قصيرة ← لا طلب ثالث
  await act(async () => {
    fireEvent(screen.getByTestId('history-list'), 'endReached');
  });
  expect(historyCalls(fake)).toHaveLength(2);
});

it('refreshes on a cash_handover notification (back to the first page)', async () => {
  const fake = setup([[MATCH], [OVER, MATCH]]);
  await renderScreen(<CashHistoryScreen />);
  await screen.findByTestId('history-row-h1');
  await act(async () => emitNotification({ type: 'cash_handover' }));
  await screen.findByTestId('history-row-h3');
  expect(historyCalls(fake)).toHaveLength(2);
});

it('an error shows a message, not the empty state', async () => {
  mockClient = createFakeSupabase(() => ({
    data: null,
    error: { message: 'Network request failed' },
  })).client;
  await renderScreen(<CashHistoryScreen />);
  expect(await screen.findByTestId('history-error')).toBeTruthy();
  await waitFor(() => expect(screen.queryByTestId('history-empty')).toBeNull());
});
