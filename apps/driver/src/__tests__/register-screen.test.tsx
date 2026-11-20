// شاشة التسجيل (التصميم: الاسم، الرقم، "إرسال الطلب") ← Pending؛ والخطأ بالعربي.
import { ERROR_MESSAGES } from '@mukhdar/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import RegisterScreen from '../app/auth/register';
import { useAuth } from '../features/auth/store';
import { ar } from '../i18n/ar';
import { createFakeSupabase, functionError, type Result } from '../test-utils/fakeSupabase';
import { renderScreen } from '../test-utils/render';

let mockClient: unknown = null;
jest.mock('../lib/supabase', () => ({ getSupabase: () => mockClient }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a), canGoBack: () => false },
}));

function setup(resolve: () => Result) {
  const fake = createFakeSupabase((call) =>
    call.table === 'fn:driver-register' ? resolve() : { data: null, error: null },
  );
  mockClient = fake.client;
  return fake;
}

beforeEach(() => {
  mockReplace.mockClear();
  useAuth.setState({ hasRegistration: false });
});

it('sends the request, then the guard allows Pending', async () => {
  const fake = setup(() => ({ data: { request_id: 'r1' }, error: null }));
  await renderScreen(<RegisterScreen />);
  expect(screen.getByText(ar.register.pushHint)).toBeTruthy();
  expect(screen.getByTestId('register-submit')).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('name-input'), 'علي حسين');
  await fireEvent.changeText(screen.getByTestId('phone-input'), '07805551212');
  await fireEvent.press(screen.getByTestId('register-submit'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/auth/pending'));
  expect(useAuth.getState().hasRegistration).toBe(true);
  expect(fake.calls.map((c) => c.table)).toEqual(['fn:driver-register']);
});

it('REQUEST_EXISTS -> Arabic message, stays', async () => {
  setup(() => ({ data: null, error: functionError(409, { error: 'REQUEST_EXISTS' }) }));
  await renderScreen(<RegisterScreen />);
  await fireEvent.changeText(screen.getByTestId('name-input'), 'علي حسين');
  await fireEvent.changeText(screen.getByTestId('phone-input'), '07805551212');
  await fireEvent.press(screen.getByTestId('register-submit'));
  expect(await screen.findByText(ERROR_MESSAGES.REQUEST_EXISTS)).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
});

it('back goes to Login', async () => {
  setup(() => ({ data: null, error: null }));
  await renderScreen(<RegisterScreen />);
  await fireEvent.press(screen.getByTestId('back'));
  expect(mockReplace).toHaveBeenCalledWith('/auth/login');
});
