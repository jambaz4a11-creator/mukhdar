// العناوين (T12؛ نطاقات بسماية 2026-11-19: البلوك ← البناية ← الطابق ← الشقة، كلها قوائم اختيار): النموذج
// (لا حفظ بدون كل الحقول، تغيير البلوك يمسح البناية، قوائم G..9 و1..12، العناوين القديمة غير الصالحة)، القائمة
// (افتراضي واحد، حذف، اختيار)، و"التوصيل إلى" بالرئيسية. Supabase مزيف، بلا شبكة.
import { type Query, QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '../test-utils/queryClient';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Alert, type AlertButton } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AddressesScreen from '../app/address/index';
import EditAddressScreen from '../app/address/[id]';
import NewAddressScreen from '../app/address/new';
import { DeliveryAddressHeader } from '../components/DeliveryAddressHeader';
import {
  addressNeedsFix,
  type CustomerAddress,
  pickDeliveryAddress,
  sortBuildings,
} from '../features/addresses/api';
import { useSelectedAddress } from '../features/addresses/selected';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { shouldPersistQuery } from '../lib/query';
import { type Call, createFakeSupabase, opArgs, type Result } from '../test-utils/fakeSupabase';
import { expectTouchTarget } from '../test-utils/touchTarget';

// ------------------------------------------------------------------ mocks
let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockRouter.push(...a),
    replace: (...a: unknown[]) => mockRouter.replace(...a),
    back: (...a: unknown[]) => mockRouter.back(...a),
    canGoBack: () => mockRouter.canGoBack(),
  },
  useLocalSearchParams: () => mockParams,
  usePathname: () => '/address',
}));

const SESSION = { user: { id: 'u1', phone: '9647701234567' }, access_token: 't' };

// ------------------------------------------------------------------ بيانات مزيفة
// القطاع A (id 1): A1..A9 (ids 11..19)؛ القطاع B (id 2): B1, B2, B3, B8 (ids 21..24؛ B4..B7 مخفية فلا تُقرأ).
// عمارات كل بلوك 1..N فقط (id = البلوك*1000 + الرقم)، N من بيانات المالك (scripts/address-tree/data.json).
const SECTORS = [
  { id: 1, name: 'قطاع A' },
  { id: 2, name: 'قطاع B' },
];
const UNIT_NAMES: Record<number, string[]> = {
  1: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'],
  2: ['B1', 'B2', 'B3', 'B8'],
};
const BUILDING_COUNT: Record<string, number> = {
  A1: 12,
  A2: 14,
  A3: 14,
  A4: 12,
  A5: 12,
  A6: 12,
  A7: 13,
  A8: 15,
  A9: 15,
  B1: 12,
  B2: 18,
  B3: 18,
  B8: 12,
};
const unitsOf = (sectorId: number) =>
  (UNIT_NAMES[sectorId] ?? []).map((name, i) => ({ id: sectorId * 10 + i + 1, name }));
const buildingsOf = (unitId: number) => {
  const name = unitsOf(Math.floor(unitId / 10)).find((u) => u.id === unitId)?.name ?? '';
  return Array.from({ length: BUILDING_COUNT[name] ?? 0 }, (_, i) => ({
    id: unitId * 1000 + i + 1,
    number: String(i + 1),
  })).reverse(); // مقلوبة عمداً: الترتيب من التطبيق
};

function makeAddress(
  id: string,
  opts: {
    unit?: number;
    building?: number;
    apartment?: string;
    floor?: number | null;
    isDefault?: boolean;
    at?: string;
  },
): CustomerAddress {
  const unitId = opts.unit ?? 13;
  const sectorId = Math.floor(unitId / 10);
  const unit = unitsOf(sectorId).find((u) => u.id === unitId) as { id: number; name: string };
  const number = opts.building ?? 12;
  return {
    id,
    apartment: opts.apartment ?? '5',
    floor: opts.floor === undefined ? 2 : opts.floor,
    note: null,
    label: null,
    is_default: opts.isDefault ?? false,
    created_at: opts.at ?? '2026-11-15T10:00:00Z',
    building: {
      id: unitId * 1000 + number,
      number: String(number),
      subsection: {
        id: unitId,
        name: unit.name,
        sector: SECTORS.find((s) => s.id === sectorId) ?? null,
      },
    },
  };
}

const eqArg = (call: Call, column: string) =>
  call.ops.find(([n, a]) => n === 'eq' && a[0] === column)?.[1][1];

function setup(addresses: CustomerAddress[] = []) {
  const fake = createFakeSupabase((call: Call): Result => {
    switch (call.table) {
      case 'sectors':
        return { data: SECTORS, error: null };
      case 'subsections':
        // البلوكات: كل الوحدات مع قطاعها بطلب واحد (مقلوبة عمداً: الترتيب من التطبيق)
        return {
          data: [...SECTORS].reverse().flatMap((sec, i) =>
            unitsOf(sec.id).map((u) => ({
              ...u,
              sort_order: 0,
              sector: { ...sec, sort_order: SECTORS.length - 1 - i },
            })),
          ),
          error: null,
        };
      case 'buildings':
        return { data: buildingsOf(eqArg(call, 'subsection_id') as number), error: null };
      case 'addresses':
        if (opArgs(call, 'insert')) return { data: { id: 'new-id' }, error: null };
        if (opArgs(call, 'update') || opArgs(call, 'delete')) return { data: null, error: null };
        return { data: addresses, error: null };
      default:
        return { data: null, error: null };
    }
  });
  mockClient = fake.client;
  return fake;
}

/** كتابات العناوين بالترتيب، ومنها RPC set_default_address. */
const writes = (calls: Call[]) =>
  calls.filter(
    (c) =>
      c.table === 'rpc:set_default_address' ||
      (c.table === 'addresses' &&
        (opArgs(c, 'insert') || opArgs(c, 'update') || opArgs(c, 'delete'))),
  );
const rpcAddress = (call: Call) => {
  expect(call.table).toBe('rpc:set_default_address');
  return (opArgs(call, 'rpc')?.[0] as { p_address_id: string }).p_address_id;
};

async function renderUi(ui: ReactElement) {
  const client = createTestQueryClient();
  return await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>
    </SafeAreaProvider>,
  );
}

const isDisabled = (testID: string) =>
  screen.getByTestId(testID).props.accessibilityState?.disabled === true;
const isSelected = (testID: string) =>
  screen.getByTestId(testID).props.accessibilityState?.selected === true;

/** يختار البلوك من القائمة المنسدلة. */
async function pickBlock(id: number) {
  await fireEvent.press(await screen.findByTestId('block-select'));
  await fireEvent.press(await screen.findByTestId(`block-${id}`));
}

/** يختار من قائمة منسدلة: يفتحها ثم يضغط الخيار. */
async function pickFrom(field: 'building' | 'floor' | 'apartment', value: number | string) {
  await fireEvent.press(await screen.findByTestId(`${field}-select`));
  await fireEvent.press(await screen.findByTestId(`${field}-${value}`));
}

/** يختار البلوك A3 ← البناية 12 ← الطابق 2 (الشقة منفصلة). */
async function pickA3Building12() {
  await pickBlock(13);
  await pickFrom('building', 12);
  await pickFrom('floor', 2);
}

beforeEach(() => {
  mockParams = {};
  Object.values(mockRouter).forEach((f) => f.mockClear());
  mockRouter.canGoBack.mockReturnValue(true);
  useAuth.setState({ session: SESSION as never, ready: true });
  useSelectedAddress.setState({ selectedId: null });
});

// ------------------------------------------------------------------ مساعدات
describe('address helpers', () => {
  it('building list is sorted numerically (1..N), whatever the order from the server', () => {
    const sorted = sortBuildings(buildingsOf(13));
    expect(sorted.map((b) => b.number)).toEqual(
      Array.from({ length: 14 }, (_, i) => String(i + 1)),
    );
    expect(sorted[11]?.id).toBe(13012);
  });

  it('old address needs a fix: floor missing or outside G..9, apartment outside 1..12 or not a number', () => {
    expect(addressNeedsFix({ floor: 0, apartment: '12' })).toBe(false);
    expect(addressNeedsFix({ floor: 9, apartment: '1' })).toBe(false);
    expect(addressNeedsFix({ floor: null, apartment: '5' })).toBe(true);
    expect(addressNeedsFix({ floor: 10, apartment: '5' })).toBe(true);
    expect(addressNeedsFix({ floor: 3, apartment: '13' })).toBe(true);
    expect(addressNeedsFix({ floor: 3, apartment: '٥' })).toBe(true);
    expect(addressNeedsFix({ floor: 3, apartment: 'ا' })).toBe(true);
  });

  it('delivery address: selected, else default, else newest; skips unavailable ones', () => {
    const a = makeAddress('a', {});
    const b = makeAddress('b', { isDefault: true });
    const broken = { ...makeAddress('x', {}), building: null };
    expect(pickDeliveryAddress([b, a], 'a')?.id).toBe('a');
    expect(pickDeliveryAddress([b, a], 'gone')?.id).toBe('b');
    expect(pickDeliveryAddress([a], null)?.id).toBe('a');
    expect(pickDeliveryAddress([broken], 'x')).toBeNull();
    expect(pickDeliveryAddress([], null)).toBeNull();
    // عنوان قديم غير صالح (بلا طابق) لا يُختار للتوصيل ولو كان المختار أو الافتراضي (2026-11-19)
    const oldInvalid = makeAddress('o', { isDefault: true, floor: null });
    expect(pickDeliveryAddress([oldInvalid], 'o')).toBeNull();
    expect(pickDeliveryAddress([oldInvalid, a], 'o')?.id).toBe('a');
  });
});

// ------------------------------------------------------------------ النموذج
describe('address form', () => {
  it('saves only when block, building, floor and apartment are all chosen', async () => {
    const { calls } = setup();
    await renderUi(<NewAddressScreen />);
    await screen.findByTestId('address-save');
    expect(isDisabled('address-save')).toBe(true);
    await pickA3Building12();
    expect(isDisabled('address-save')).toBe(true); // بلا شقة
    await fireEvent.press(screen.getByTestId('address-save'));
    expect(writes(calls)).toHaveLength(0);
    await pickFrom('apartment', 1);
    expect(isDisabled('address-save')).toBe(false);
  });

  it('building is disabled until a block is chosen', async () => {
    setup();
    await renderUi(<NewAddressScreen />);
    expect(await screen.findByTestId('building-value')).toHaveTextContent(
      ar.address.buildingPickBlock,
    );
    expect(isDisabled('building-select')).toBe(true);
    await fireEvent.press(screen.getByTestId('building-select'));
    expect(screen.queryByTestId('building-list')).toBeNull();
  });

  it('block dropdown: A1..A9 then B1, B2, B3, B8 only (B4..B7 do not exist), closes on pick', async () => {
    setup();
    await renderUi(<NewAddressScreen />);
    expect(await screen.findByTestId('block-value')).toHaveTextContent(ar.address.blockPlaceholder);
    expect(screen.queryByTestId('block-list')).toBeNull();
    await fireEvent.press(screen.getByTestId('block-select'));
    const list = await screen.findByTestId('block-list');
    const ids = (await screen.findAllByTestId(/^block-\d+$/)).map((n) => n.props.testID);
    expect(ids).toEqual([...unitsOf(1), ...unitsOf(2)].map((u) => `block-${u.id}`));
    expect(ids).toHaveLength(13);
    expect(list).toHaveTextContent(/قطاع A.*قطاع B/);
    expect(list).not.toHaveTextContent('B4');
    await fireEvent.press(screen.getByTestId('block-24'));
    expect(screen.queryByTestId('block-list')).toBeNull();
    expect(screen.getByTestId('block-value')).toHaveTextContent('B8');
    await fireEvent.press(screen.getByTestId('block-select'));
    expect(isSelected('block-24')).toBe(true);
    expect(isSelected('block-13')).toBe(false);
  });

  it('building list is exactly 1..N of the chosen block, no free typing', async () => {
    setup();
    await renderUi(<NewAddressScreen />);
    await pickBlock(13); // A3: 14 بناية
    await fireEvent.press(screen.getByTestId('building-select'));
    let numbers = (await screen.findAllByTestId(/^building-\d+$/)).map((n) => n.props.testID);
    expect(numbers).toEqual(Array.from({ length: 14 }, (_, i) => `building-${i + 1}`));
    await pickBlock(22); // B2: 18 بناية
    await fireEvent.press(screen.getByTestId('building-select'));
    numbers = (await screen.findAllByTestId(/^building-\d+$/)).map((n) => n.props.testID);
    expect(numbers).toHaveLength(18);
    expect(screen.queryByTestId('building-19')).toBeNull();
    // لا حقل نصي للبناية ولا للطابق ولا للشقة
    expect(screen.queryByTestId('building-input')).toBeNull();
    expect(screen.queryByTestId('floor-input')).toBeNull();
    expect(screen.queryByTestId('apartment-input')).toBeNull();
  });

  it('floor list is G then 1..9; apartment list is 1..12', async () => {
    setup();
    await renderUi(<NewAddressScreen />);
    await fireEvent.press(await screen.findByTestId('floor-select'));
    const floors = await screen.findAllByTestId(/^floor-\d+$/);
    expect(floors.map((n) => n.props.testID)).toEqual(
      Array.from({ length: 10 }, (_, i) => `floor-${i}`),
    );
    expect(screen.getByTestId('floor-list')).toHaveTextContent('G123456789');
    expect(screen.getByLabelText('G')).toBeTruthy();
    expect(screen.queryByTestId('floor-10')).toBeNull();
    await fireEvent.press(screen.getByTestId('floor-0'));
    expect(screen.getByTestId('floor-value')).toHaveTextContent('G');
    expect(screen.queryByTestId('floor-list')).toBeNull();

    await fireEvent.press(screen.getByTestId('apartment-select'));
    const apartments = await screen.findAllByTestId(/^apartment-\d+$/);
    expect(apartments.map((n) => n.props.testID)).toEqual(
      Array.from({ length: 12 }, (_, i) => `apartment-${i + 1}`),
    );
    expect(screen.queryByTestId('apartment-13')).toBeNull();
    expect(screen.queryByTestId('apartment-0')).toBeNull();
  });

  it('only one dropdown is open at a time', async () => {
    setup();
    await renderUi(<NewAddressScreen />);
    await fireEvent.press(await screen.findByTestId('floor-select'));
    expect(screen.getByTestId('floor-list')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('apartment-select'));
    expect(screen.queryByTestId('floor-list')).toBeNull();
    expect(screen.getByTestId('apartment-list')).toBeTruthy();
  });

  it('changing the block clears the building', async () => {
    setup();
    await renderUi(<NewAddressScreen />);
    await pickA3Building12();
    expect(screen.getByTestId('building-value')).toHaveTextContent('12');
    await pickBlock(21);
    expect(screen.getByTestId('building-value')).toHaveTextContent(ar.address.buildingPlaceholder);
    expect(isDisabled('address-save')).toBe(true);
    await pickFrom('building', 9);
    expect(screen.getByTestId('building-value')).toHaveTextContent('9');
    // نفس البلوك مرة ثانية: لا يمسح
    await pickBlock(21);
    expect(screen.getByTestId('building-value')).toHaveTextContent('9');
  });

  it('first address: added, made default by the RPC, selected, then back; ground floor shown as G', async () => {
    const { calls } = setup([]);
    await renderUi(<NewAddressScreen />);
    await pickBlock(13);
    await pickFrom('building', 12);
    await pickFrom('floor', 0);
    await pickFrom('apartment', 4);
    await fireEvent.press(screen.getByTestId('label-البيت'));
    expect(screen.getByTestId('label-input').props.value).toBe('البيت');
    await fireEvent.changeText(screen.getByTestId('note-input'), 'الباب الأخضر');
    expect(screen.getByTestId('address-preview')).toHaveTextContent(
      'بلوك A3 · بناية 12 · الطابق G · شقة 4',
    );
    // أول عنوان: افتراضي إجباري
    const toggle = screen.getByTestId('default-toggle');
    expect(toggle.props.accessibilityState).toEqual({ checked: true, disabled: true });

    await fireEvent.press(screen.getByTestId('address-save'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());

    // يُضاف غير افتراضي، ثم يصير افتراضياً بالـ RPC (معاملة واحدة)
    const w = writes(calls);
    expect(w).toHaveLength(2);
    const [insert, rpc] = w as [Call, Call];
    expect(opArgs(insert, 'insert')).toEqual([
      {
        building_id: 13012,
        floor: 0,
        apartment: '4',
        note: 'الباب الأخضر',
        label: 'البيت',
        customer_id: 'u1',
        is_default: false,
      },
    ]);
    expect(rpcAddress(rpc)).toBe('new-id');
    expect(useSelectedAddress.getState().selectedId).toBe('new-id');
  });

  it('another address, not default: no default change', async () => {
    const { calls } = setup([makeAddress('a1', { isDefault: true })]);
    await renderUi(<NewAddressScreen />);
    await pickA3Building12();
    expect(screen.getByTestId('default-toggle').props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    await pickFrom('apartment', 3);
    await fireEvent.changeText(screen.getByTestId('label-input'), ' بيت أهلي ');
    await fireEvent.press(screen.getByTestId('address-save'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(opArgs(w[0] as Call, 'insert')).toEqual([
      expect.objectContaining({
        is_default: false,
        label: 'بيت أهلي',
        note: null,
        floor: 2,
        apartment: '3',
      }),
    ]);
  });

  it('after the name screen: step 2 of 2, "later" and save both go to the redirect', async () => {
    mockParams = { onboarding: '1', redirect: '/orders' };
    setup([]);
    await renderUi(<NewAddressScreen />);
    expect(await screen.findByText(ar.address.onboardingStep)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('address-later'));
    expect(mockRouter.replace).toHaveBeenCalledWith('/orders');

    mockRouter.replace.mockClear();
    await pickA3Building12();
    await pickFrom('apartment', 1);
    await fireEvent.press(screen.getByTestId('address-save'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/orders'));
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('edit: prefilled from the address, updates it by id', async () => {
    mockParams = { id: 'a2' };
    const { calls } = setup([
      makeAddress('a1', { isDefault: true }),
      makeAddress('a2', { unit: 24, building: 10, apartment: '7', floor: 3 }),
    ]);
    await renderUi(<EditAddressScreen />);
    expect(await screen.findByText(ar.address.editTitle)).toBeTruthy();
    // العنصر موجود من أول رسم بنص الاختيار الفارغ، فننتظر وصول قيمة العنوان نفسها (لا findBy وحدها)
    await waitFor(() => expect(screen.getByTestId('block-value')).toHaveTextContent('B8'));
    expect(screen.getByTestId('building-value')).toHaveTextContent('10');
    expect(screen.getByTestId('floor-value')).toHaveTextContent('3');
    expect(screen.getByTestId('apartment-value')).toHaveTextContent('7');
    expect(screen.queryByTestId('address-fix-notice')).toBeNull();

    await pickFrom('apartment', 8);
    await fireEvent.press(screen.getByTestId('default-toggle'));
    await fireEvent.press(screen.getByTestId('address-save'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());

    const [update, rpc] = writes(calls) as [Call, Call];
    expect(opArgs(update, 'update')).toEqual([
      { building_id: 24010, floor: 3, apartment: '8', note: null, label: null },
    ]);
    expect(eqArg(update, 'id')).toBe('a2');
    expect(rpcAddress(rpc)).toBe('a2');
  });

  it('edit an old address with no floor and an apartment above 12: asks to fix both before saving', async () => {
    mockParams = { id: 'a1' };
    const { calls } = setup([makeAddress('a1', { isDefault: true, floor: null, apartment: '26' })]);
    await renderUi(<EditAddressScreen />);
    expect(await screen.findByTestId('address-fix-notice')).toHaveTextContent(ar.address.fixOld);
    await waitFor(() => expect(screen.getByTestId('block-value')).toHaveTextContent('A3'));
    await waitFor(() => expect(screen.getByTestId('building-value')).toHaveTextContent('12'));
    // الحقلان غير الصالحين يبدآن فارغين
    expect(screen.getByTestId('floor-value')).toHaveTextContent(ar.address.floorPlaceholder);
    expect(screen.getByTestId('apartment-value')).toHaveTextContent(
      ar.address.apartmentPlaceholder,
    );
    expect(isDisabled('address-save')).toBe(true);
    await pickFrom('floor', 4);
    expect(isDisabled('address-save')).toBe(true);
    await pickFrom('apartment', 12);
    expect(isDisabled('address-save')).toBe(false);
    await fireEvent.press(screen.getByTestId('address-save'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(opArgs(writes(calls)[0] as Call, 'update')).toEqual([
      expect.objectContaining({ floor: 4, apartment: '12' }),
    ]);
  });

  it('edit an old floor above 9 or an Arabic-digit apartment: both cleared, must be re-picked', async () => {
    mockParams = { id: 'a1' };
    setup([makeAddress('a1', { isDefault: true, floor: 15, apartment: '٥' })]);
    await renderUi(<EditAddressScreen />);
    expect(await screen.findByTestId('address-fix-notice')).toBeTruthy();
    expect(screen.getByTestId('floor-value')).toHaveTextContent(ar.address.floorPlaceholder);
    expect(screen.getByTestId('apartment-value')).toHaveTextContent(
      ar.address.apartmentPlaceholder,
    );
  });

  it('edit an old address whose building is now hidden: starts from an empty block', async () => {
    mockParams = { id: 'a1' };
    setup([{ ...makeAddress('a1', { isDefault: true }), building: null }]);
    await renderUi(<EditAddressScreen />);
    expect(await screen.findByTestId('block-value')).toHaveTextContent(ar.address.blockPlaceholder);
    expect(isDisabled('building-select')).toBe(true);
    expect(isDisabled('address-save')).toBe(true);
  });
});

// ------------------------------------------------------------------ القائمة
describe('my addresses', () => {
  const list = () => [
    makeAddress('a1', { isDefault: true, at: '2026-11-10T00:00:00Z' }),
    makeAddress('a2', { unit: 24, building: 10, apartment: '7', at: '2026-11-12T00:00:00Z' }),
    makeAddress('a3', { unit: 11, building: 1, apartment: '2', at: '2026-11-11T00:00:00Z' }),
  ];

  it('lists addresses with formatAddress and one default badge', async () => {
    setup(list());
    await renderUi(<AddressesScreen />);
    expect(await screen.findByText('بلوك A3 · بناية 12 · الطابق 2 · شقة 5')).toBeTruthy();
    expect(screen.getByText('بلوك B8 · بناية 10 · الطابق 2 · شقة 7')).toBeTruthy();
    expect(screen.getAllByText(ar.address.defaultBadge)).toHaveLength(1);
    // "اجعله افتراضياً" للعناوين غير الافتراضية فقط
    expect(screen.getAllByLabelText(ar.address.setDefault)).toHaveLength(2);
  });

  it('shows the floor in the list when the address has one', async () => {
    setup([makeAddress('a1', { isDefault: true, floor: 0 })]);
    await renderUi(<AddressesScreen />);
    expect(await screen.findByText('بلوك A3 · بناية 12 · الطابق G · شقة 5')).toBeTruthy();
  });

  it('old invalid addresses show a fix hint and open the form instead of being picked', async () => {
    mockParams = { select: '1' };
    setup([
      makeAddress('ok', { isDefault: true }),
      makeAddress('old', { unit: 24, building: 10, floor: null, apartment: '26' }),
    ]);
    await renderUi(<AddressesScreen />);
    expect(await screen.findByTestId('address-fix-old')).toHaveTextContent(ar.address.needsFix);
    expect(screen.queryByTestId('address-fix-ok')).toBeNull();
    await fireEvent.press(screen.getByLabelText('بلوك B8 · بناية 10 · شقة 26'));
    expect(useSelectedAddress.getState().selectedId).toBeNull();
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/address/[id]',
      params: { id: 'old' },
    });
  });

  it('set default: one atomic RPC call (set_default_address)', async () => {
    const { calls } = setup(list());
    await renderUi(<AddressesScreen />);
    await screen.findByText('بلوك B8 · بناية 10 · الطابق 2 · شقة 7');
    await fireEvent.press(screen.getAllByLabelText(ar.address.setDefault)[0] as never);
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(rpcAddress(writes(calls)[0] as Call)).toBe('a2');
  });

  it('deleting the default (after confirming) makes the newest remaining address the default', async () => {
    const alert = jest
      .spyOn(Alert, 'alert')
      .mockImplementation((_t, _m, buttons?: AlertButton[]) => {
        buttons?.find((b) => b.style === 'destructive')?.onPress?.();
      });
    useSelectedAddress.setState({ selectedId: 'a1' });
    const { calls } = setup(list());
    await renderUi(<AddressesScreen />);
    await screen.findByText('بلوك A3 · بناية 12 · الطابق 2 · شقة 5');
    await act(async () => {
      fireEvent.press(screen.getAllByLabelText(ar.address.delete)[0] as never);
    });
    await waitFor(() => expect(writes(calls)).toHaveLength(2));
    const [del, rpc] = writes(calls) as [Call, Call];
    expect(opArgs(del, 'delete')).toEqual([]);
    expect(eqArg(del, 'id')).toBe('a1');
    expect(rpcAddress(rpc)).toBe('a2'); // الأحدث بين الباقية
    expect(useSelectedAddress.getState().selectedId).toBeNull();
    alert.mockRestore();
  });

  it('cancelled delete: nothing is written', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const { calls } = setup(list());
    await renderUi(<AddressesScreen />);
    await screen.findByText('بلوك A3 · بناية 12 · الطابق 2 · شقة 5');
    await fireEvent.press(screen.getAllByLabelText(ar.address.delete)[1] as never);
    expect(alert).toHaveBeenCalled();
    expect(writes(calls)).toHaveLength(0);
    alert.mockRestore();
  });

  it('select mode: tapping an address picks it for delivery and goes back', async () => {
    mockParams = { select: '1' };
    setup(list());
    await renderUi(<AddressesScreen />);
    expect(await screen.findByText(ar.address.selectTitle)).toBeTruthy();
    await fireEvent.press(await screen.findByLabelText('بلوك B8 · بناية 10 · الطابق 2 · شقة 7'));
    expect(useSelectedAddress.getState().selectedId).toBe('a2');
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('empty list: hint and add button', async () => {
    setup([]);
    await renderUi(<AddressesScreen />);
    expect(await screen.findByTestId('addresses-empty')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('address-add'));
    expect(mockRouter.push).toHaveBeenCalledWith('/address/new');
  });
});

// ------------------------------------------------------------------ "التوصيل إلى" بالرئيسية
describe('delivery address header', () => {
  it('shows the default address (formatAddressShort); tap opens address selection', async () => {
    setup([makeAddress('a2', { unit: 24, building: 10 }), makeAddress('a1', { isDefault: true })]);
    await renderUi(<DeliveryAddressHeader />);
    expect(await screen.findByText('بلوك A3 - بناية 12')).toBeTruthy();
    // مراجعة S6: مساحة لمس ≥ 44
    expectTouchTarget(screen.getByTestId('delivery-address'));
    await fireEvent.press(screen.getByTestId('delivery-address'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/address',
      params: { select: '1' },
    });
  });

  it('shows the address chosen on this device over the default', async () => {
    useSelectedAddress.setState({ selectedId: 'a2' });
    setup([makeAddress('a1', { isDefault: true }), makeAddress('a2', { unit: 24, building: 10 })]);
    await renderUi(<DeliveryAddressHeader />);
    expect(await screen.findByText('بلوك B8 - بناية 10')).toBeTruthy();
  });

  it('signed in without addresses: tap goes to adding the first address', async () => {
    setup([]);
    await renderUi(<DeliveryAddressHeader />);
    expect(await screen.findByText(ar.address.addFirst)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('delivery-address'));
    expect(mockRouter.push).toHaveBeenCalledWith('/address/new');
  });

  it('signed out: asks to choose an address, without reading addresses', async () => {
    useAuth.setState({ session: null, ready: true });
    const { calls } = setup([makeAddress('a1', { isDefault: true })]);
    await renderUi(<DeliveryAddressHeader />);
    expect(screen.getByText(ar.address.chooseAddress)).toBeTruthy();
    expect(calls.filter((c) => c.table === 'addresses')).toHaveLength(0);
  });
});

describe('persisted cache', () => {
  it('never writes personal data (addresses, orders, profile) to the device cache; the lists are kept', () => {
    const q = (queryKey: readonly unknown[]) =>
      ({ queryKey, state: { status: 'success' } }) as unknown as Query;
    expect(shouldPersistQuery(q(['addresses', 'u1']))).toBe(false);
    // NH11: الطلبات (القوائم والتفاصيل) والاسم أيضاً
    expect(shouldPersistQuery(q(['orders', 'u1']))).toBe(false);
    expect(shouldPersistQuery(q(['orders', 'detail', 'o1']))).toBe(false);
    expect(shouldPersistQuery(q(['profile', 'u1']))).toBe(false);
    expect(shouldPersistQuery(q(['address', 'buildings', 13]))).toBe(true);
    expect(shouldPersistQuery(q(['products', 'list', null]))).toBe(true);
  });
});
