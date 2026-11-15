// العناوين (T12): النموذج (لا حفظ بدون شقة، تغيير القطاع يمسح ما بعده، التحقق من رقم العمارة)، القائمة
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
  type CustomerAddress,
  indexBuildings,
  normalizeBuildingInput,
  pickDeliveryAddress,
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
// القطاع A (id 1): A1..A9 (ids 11..19)؛ القطاع B (id 2): B1..B8 (ids 21..28).
// العمارات 1..100 لكل وحدة (id = الوحدة*1000 + الرقم)، والعمارة 77 موقوفة (لا تُقرأ).
const SECTORS = [
  { id: 1, name: 'قطاع A' },
  { id: 2, name: 'قطاع B' },
];
const unitsOf = (sectorId: number) => {
  const letter = sectorId === 1 ? 'A' : 'B';
  const count = sectorId === 1 ? 9 : 8;
  return Array.from({ length: count }, (_, i) => ({
    id: sectorId * 10 + i + 1,
    name: `${letter}${i + 1}`,
  }));
};
const buildingsOf = (unitId: number) =>
  Array.from({ length: 100 }, (_, i) => i + 1)
    .filter((n) => n !== 77)
    .map((n) => ({ id: unitId * 1000 + n, number: String(n) }));

function makeAddress(
  id: string,
  opts: { unit?: number; building?: number; apartment?: string; isDefault?: boolean; at?: string },
): CustomerAddress {
  const unitId = opts.unit ?? 13;
  const sectorId = Math.floor(unitId / 10);
  const unit = unitsOf(sectorId).find((u) => u.id === unitId) as { id: number; name: string };
  const number = opts.building ?? 12;
  return {
    id,
    apartment: opts.apartment ?? '5',
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
        return { data: unitsOf(eqArg(call, 'sector_id') as number), error: null };
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

/** يختار قطاع A ← وحدة A3 ← عمارة 45. */
async function pickA3Building45() {
  await fireEvent.press(await screen.findByTestId('sector-1'));
  await fireEvent.press(await screen.findByTestId('unit-13'));
  await fireEvent.changeText(screen.getByTestId('building-input'), '45');
  expect(await screen.findByTestId('building-found')).toBeTruthy();
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
  it('building input: Latin digits only, no leading zeros, at most 3 digits', () => {
    expect(normalizeBuildingInput('٤٥')).toBe('45');
    expect(normalizeBuildingInput('045')).toBe('45');
    expect(normalizeBuildingInput('a1b2')).toBe('12');
    expect(normalizeBuildingInput('1234')).toBe('123');
    expect(normalizeBuildingInput('0')).toBe('0');
    expect(normalizeBuildingInput('')).toBe('');
  });

  it('finds any of 100 buildings by number instantly', () => {
    const index = indexBuildings(buildingsOf(13));
    const started = Date.now();
    for (let n = 1; n <= 100; n++) index.get(String(n));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(index.get('45')?.id).toBe(13045);
    expect(index.get('77')).toBeUndefined();
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
  });
});

// ------------------------------------------------------------------ النموذج
describe('address form', () => {
  it('does not save without an apartment', async () => {
    const { calls } = setup();
    await renderUi(<NewAddressScreen />);
    await screen.findByTestId('address-save');
    expect(isDisabled('address-save')).toBe(true);
    await pickA3Building45();
    expect(isDisabled('address-save')).toBe(true);
    await fireEvent.press(screen.getByTestId('address-save'));
    await fireEvent.changeText(screen.getByTestId('apartment-input'), '   ');
    expect(isDisabled('address-save')).toBe(true);
    expect(writes(calls)).toHaveLength(0);
  });

  it('changing the sector clears the unit and building; changing the unit clears the building', async () => {
    setup();
    await renderUi(<NewAddressScreen />);
    await pickA3Building45();
    expect(isSelected('unit-13')).toBe(true);

    await fireEvent.press(screen.getByTestId('sector-2'));
    expect(await screen.findByTestId('unit-28')).toBeTruthy(); // B8
    expect(screen.queryByTestId('unit-13')).toBeNull();
    expect(screen.queryByTestId('unit-19')).toBeNull(); // لا A9 بالقطاع B
    expect(screen.getByTestId('building-input').props.value).toBe('');
    expect(screen.queryByTestId('building-found')).toBeNull();
    expect(screen.getByTestId('building-status')).toHaveTextContent(ar.address.buildingPickUnit);

    await fireEvent.press(screen.getByTestId('unit-21'));
    await fireEvent.changeText(screen.getByTestId('building-input'), '9');
    expect(await screen.findByTestId('building-found')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('unit-22'));
    expect(screen.getByTestId('building-input').props.value).toBe('');
  });

  it('validates the typed building number against the active buildings of the unit', async () => {
    setup();
    await renderUi(<NewAddressScreen />);
    await fireEvent.press(await screen.findByTestId('sector-1'));
    await fireEvent.press(await screen.findByTestId('unit-13'));
    const input = screen.getByTestId('building-input');

    await fireEvent.changeText(input, '٧٧'); // موقوفة
    expect(await screen.findByText(ar.address.buildingNotFound)).toBeTruthy();
    await fireEvent.changeText(input, '101');
    expect(screen.getByText(ar.address.buildingNotFound)).toBeTruthy();
    await fireEvent.changeText(input, '١٠٠');
    expect(await screen.findByTestId('building-found')).toBeTruthy();
    expect(input.props.value).toBe('100');
  });

  it('first address: added, made default by the RPC, selected, then back', async () => {
    const { calls } = setup([]);
    await renderUi(<NewAddressScreen />);
    await pickA3Building45();
    await fireEvent.changeText(screen.getByTestId('apartment-input'), ' 12 ');
    await fireEvent.press(screen.getByTestId('label-البيت'));
    await fireEvent.changeText(screen.getByTestId('note-input'), 'الطابق الثالث');
    expect(screen.getByTestId('address-preview')).toHaveTextContent(
      'قطاع A · وحدة A3 · عمارة 45 · شقة 12',
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
        building_id: 13045,
        apartment: '12',
        note: 'الطابق الثالث',
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
    await pickA3Building45();
    expect(screen.getByTestId('default-toggle').props.accessibilityState).toEqual({
      checked: false,
      disabled: false,
    });
    await fireEvent.changeText(screen.getByTestId('apartment-input'), '3');
    await fireEvent.press(screen.getByTestId('address-save'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(opArgs(w[0] as Call, 'insert')).toEqual([
      expect.objectContaining({ is_default: false, label: null, note: null }),
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
    await pickA3Building45();
    await fireEvent.changeText(screen.getByTestId('apartment-input'), '1');
    await fireEvent.press(screen.getByTestId('address-save'));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/orders'));
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it('edit: prefilled from the address, updates it by id', async () => {
    mockParams = { id: 'a2' };
    const { calls } = setup([
      makeAddress('a1', { isDefault: true }),
      makeAddress('a2', { unit: 24, building: 60, apartment: '7' }),
    ]);
    await renderUi(<EditAddressScreen />);
    expect(await screen.findByText(ar.address.editTitle)).toBeTruthy();
    expect(await screen.findByTestId('building-found')).toBeTruthy();
    expect(isSelected('sector-2')).toBe(true);
    expect(isSelected('unit-24')).toBe(true);
    expect(screen.getByTestId('apartment-input').props.value).toBe('7');

    await fireEvent.changeText(screen.getByTestId('apartment-input'), '8');
    await fireEvent.press(screen.getByTestId('default-toggle'));
    await fireEvent.press(screen.getByTestId('address-save'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());

    const [update, rpc] = writes(calls) as [Call, Call];
    expect(opArgs(update, 'update')).toEqual([
      { building_id: 24060, apartment: '8', note: null, label: null },
    ]);
    expect(eqArg(update, 'id')).toBe('a2');
    expect(rpcAddress(rpc)).toBe('a2');
  });
});

// ------------------------------------------------------------------ القائمة
describe('my addresses', () => {
  const list = () => [
    makeAddress('a1', { isDefault: true, at: '2026-11-10T00:00:00Z' }),
    makeAddress('a2', { unit: 24, building: 60, apartment: '7', at: '2026-11-12T00:00:00Z' }),
    makeAddress('a3', { unit: 11, building: 1, apartment: '2', at: '2026-11-11T00:00:00Z' }),
  ];

  it('lists addresses with formatAddress and one default badge', async () => {
    setup(list());
    await renderUi(<AddressesScreen />);
    expect(await screen.findByText('قطاع A · وحدة A3 · عمارة 12 · شقة 5')).toBeTruthy();
    expect(screen.getByText('قطاع B · وحدة B4 · عمارة 60 · شقة 7')).toBeTruthy();
    expect(screen.getAllByText(ar.address.defaultBadge)).toHaveLength(1);
    // "اجعله افتراضياً" للعناوين غير الافتراضية فقط
    expect(screen.getAllByLabelText(ar.address.setDefault)).toHaveLength(2);
  });

  it('set default: one atomic RPC call (set_default_address)', async () => {
    const { calls } = setup(list());
    await renderUi(<AddressesScreen />);
    await screen.findByText('قطاع B · وحدة B4 · عمارة 60 · شقة 7');
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
    await screen.findByText('قطاع A · وحدة A3 · عمارة 12 · شقة 5');
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
    await screen.findByText('قطاع A · وحدة A3 · عمارة 12 · شقة 5');
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
    await fireEvent.press(await screen.findByLabelText('قطاع B · وحدة B4 · عمارة 60 · شقة 7'));
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
    setup([makeAddress('a2', { unit: 24, building: 60 }), makeAddress('a1', { isDefault: true })]);
    await renderUi(<DeliveryAddressHeader />);
    expect(await screen.findByText('وحدة A3 - عمارة 12')).toBeTruthy();
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
    setup([makeAddress('a1', { isDefault: true }), makeAddress('a2', { unit: 24, building: 60 })]);
    await renderUi(<DeliveryAddressHeader />);
    expect(await screen.findByText('وحدة B4 - عمارة 60')).toBeTruthy();
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
