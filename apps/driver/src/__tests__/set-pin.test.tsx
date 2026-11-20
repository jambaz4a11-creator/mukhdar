// اختيار الرمز بعد الموافقة (SPEC-driver §2.5): validatePin + التطابق ← driver-complete-registration ←
// signInWithPassword ← مسح التخزين المحلي. PHONE_TAKEN / REQUEST_NOT_APPROVED ← قراءة الحالة.
import { ERROR_MESSAGES, PIN_MESSAGES, type MukhdarClient } from '@mukhdar/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import SetPinScreen from '../app/auth/set-pin';
import { completeRegistration } from '../features/auth/setPin';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import {
  loadRegistration,
  readSecret,
  saveRegistration,
  saveSecret,
  type Registration,
} from '../lib/secureStore';
import { createFakeSupabase, functionError, type Result } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
}));

const SECRET = 's'.repeat(43);
const REG: Registration = {
  requestId: 'r1',
  secret: SECRET,
  fullName: 'علي حسين',
  phone: '+9647805551212',
};

async function saveRequest() {
  await saveSecret(SECRET);
  await saveRegistration({ requestId: 'r1', fullName: REG.fullName, phone: REG.phone });
}

function setup(opts: { complete?: () => Result; status?: string; signIn?: () => unknown } = {}) {
  const auth = {
    signInWithPassword: jest.fn(() =>
      Promise.resolve(opts.signIn?.() ?? { data: { session: {} }, error: null }),
    ),
  };
  const fake = createFakeSupabase((call) => {
    if (call.table === 'fn:driver-complete-registration')
      return opts.complete?.() ?? { data: { created: true }, error: null };
    if (call.table === 'rpc:driver_request_status')
      return { data: opts.status ?? 'approved', error: null };
    return { data: null, error: null };
  }, auth);
  mockClient = fake.client;
  const run = (pin: string, confirm = pin) =>
    completeRegistration(fake.client as unknown as MukhdarClient, REG, pin, confirm);
  return { ...fake, auth, run };
}

beforeEach(async () => {
  mockReplace.mockClear();
  useAuth.setState({ hasRegistration: true });
  await saveRequest();
});

describe('completeRegistration', () => {
  it('checks the PIN in the app first (no call)', async () => {
    const t = setup();
    expect(await t.run('123456')).toMatchObject({ ok: false, message: PIN_MESSAGES.PIN_TRIVIAL });
    expect(await t.run('551212')).toMatchObject({
      ok: false,
      message: PIN_MESSAGES.PIN_MATCHES_PHONE,
    });
    expect(await t.run('12345')).toMatchObject({ ok: false, message: PIN_MESSAGES.PIN_LENGTH });
    expect(await t.run('730514', '730515')).toMatchObject({
      ok: false,
      message: ar.setPin.mismatch,
    });
    expect(t.calls).toEqual([]);
  });

  it('creates the account, signs in with the same phone and PIN, then clears the device', async () => {
    const t = setup();
    expect(await t.run('٧٣٠٥١٤')).toEqual({ ok: true });
    expect(t.calls[0]).toEqual({
      table: 'fn:driver-complete-registration',
      ops: [['invoke', [{ request_id: 'r1', device_secret: SECRET, pin: '730514' }]]],
    });
    expect(t.auth.signInWithPassword).toHaveBeenCalledWith({
      phone: '+9647805551212',
      password: '730514',
    });
    expect(await loadRegistration()).toBeNull();
    expect(await readSecret()).toBeNull();
    expect(useAuth.getState().hasRegistration).toBe(false);
  });

  it('server PIN_INVALID with detail -> the matching PIN message', async () => {
    const t = setup({
      complete: () => ({
        data: null,
        error: functionError(400, { error: 'PIN_INVALID', detail: 'PIN_TRIVIAL' }),
      }),
    });
    expect(await t.run('730514')).toMatchObject({ ok: false, message: PIN_MESSAGES.PIN_TRIVIAL });
  });

  it('PHONE_TAKEN and the request already completed -> login', async () => {
    const t = setup({
      complete: () => ({ data: null, error: functionError(409, { error: 'PHONE_TAKEN' }) }),
      status: 'completed',
    });
    expect(await t.run('730514')).toEqual({ ok: false, next: 'login' });
    expect(await loadRegistration()).toBeNull();
  });

  it('PHONE_TAKEN while still approved -> the driver message, stays', async () => {
    const t = setup({
      complete: () => ({ data: null, error: functionError(409, { error: 'PHONE_TAKEN' }) }),
      status: 'approved',
    });
    expect(await t.run('730514')).toEqual({ ok: false, message: ar.register.phoneTaken });
    expect(await loadRegistration()).not.toBeNull();
  });

  it('REQUEST_NOT_APPROVED and now rejected -> back to pending (shows the decision)', async () => {
    const t = setup({
      complete: () => ({
        data: null,
        error: functionError(409, { error: 'REQUEST_NOT_APPROVED' }),
      }),
      status: 'rejected',
    });
    expect(await t.run('730514')).toEqual({ ok: false, next: 'pending' });
  });

  it('REQUEST_EXPIRED -> pending; REQUEST_NOT_FOUND -> register (device cleared)', async () => {
    let t = setup({
      complete: () => ({ data: null, error: functionError(410, { error: 'REQUEST_EXPIRED' }) }),
    });
    expect(await t.run('730514')).toEqual({ ok: false, next: 'pending' });
    t = setup({
      complete: () => ({ data: null, error: functionError(404, { error: 'REQUEST_NOT_FOUND' }) }),
    });
    expect(await t.run('730514')).toEqual({ ok: false, next: 'register' });
    expect(await loadRegistration()).toBeNull();
  });

  it('rate limited -> message', async () => {
    const t = setup({
      complete: () => ({ data: null, error: functionError(429, { error: 'RATE_LIMITED' }) }),
    });
    expect(await t.run('730514')).toEqual({ ok: false, message: ERROR_MESSAGES.RATE_LIMITED });
  });

  it('account created but sign-in failed -> device cleared, login with "حسابك جاهز"', async () => {
    const t = setup({ signIn: () => ({ data: { session: null }, error: { status: 500 } }) });
    expect(await t.run('730514')).toEqual({ ok: false, next: 'login' });
    expect(await loadRegistration()).toBeNull();
  });
});

describe('Set PIN screen', () => {
  async function enter(pin: string, confirm = pin) {
    await renderScreen(<SetPinScreen />);
    expect(screen.getByText(ar.setPin.approved)).toBeTruthy();
    expect(screen.getByTestId('set-pin-submit')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('set-pin-new'), pin);
    await fireEvent.changeText(screen.getByTestId('set-pin-confirm'), confirm);
    await fireEvent.press(screen.getByTestId('set-pin-submit'));
  }

  it('mismatch is shown, nothing sent', async () => {
    const t = setup();
    await enter('730514', '730515');
    expect(await screen.findByText(ar.setPin.mismatch)).toBeTruthy();
    expect(t.calls).toEqual([]);
  });

  it('success signs in (the guard then opens the tabs)', async () => {
    const t = setup();
    await enter('730514');
    await waitFor(() => expect(t.auth.signInWithPassword).toHaveBeenCalled());
    await waitFor(() => expect(useAuth.getState().hasRegistration).toBe(false));
  });

  it('completed elsewhere -> login with notice', async () => {
    setup({
      complete: () => ({ data: null, error: functionError(409, { error: 'PHONE_TAKEN' }) }),
      status: 'completed',
    });
    await enter('730514');
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: '/auth/login',
        params: { notice: 'ready' },
      }),
    );
  });
});
