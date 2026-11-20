// الحارس المركّب بالجذر: يوجّه بـ router.replace ويغطي الشاشة حتى تُعرف الوجهة.
import { act, screen } from '@testing-library/react-native';
import { AuthGuard } from '../features/auth/AuthGuard';
import { useAuth } from '../features/auth/store';
import { renderScreen } from '../test-utils/render';

const mockReplace = jest.fn();
let mockPathname = '/';
jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a) },
  usePathname: () => mockPathname,
  useRootNavigationState: () => ({ key: 'root' }),
}));

const SESSION = { user: { id: 'u1' } } as never;

beforeEach(() => {
  mockReplace.mockClear();
  mockPathname = '/';
  useAuth.setState({
    ready: false,
    session: null,
    profile: null,
    profileError: false,
    hasRegistration: false,
  });
});

it('covers the screen until the state is known, then sends to login', async () => {
  await renderScreen(<AuthGuard />);
  expect(screen.getByTestId('guard-loading')).toBeTruthy();
  expect(mockReplace).not.toHaveBeenCalled();
  await act(() => useAuth.setState({ ready: true }));
  expect(mockReplace).toHaveBeenCalledWith('/auth/login');
});

it('saved request: pending', async () => {
  useAuth.setState({ ready: true, hasRegistration: true });
  await renderScreen(<AuthGuard />);
  expect(mockReplace).toHaveBeenCalledWith('/auth/pending');
});

it('active driver on the tabs: nothing to do, no overlay', async () => {
  useAuth.setState({
    ready: true,
    session: SESSION,
    profile: {
      role: 'driver',
      is_active: true,
      must_change_pin: false,
      full_name: 'علي',
      phone: '9647801112222',
    },
  });
  await renderScreen(<AuthGuard />);
  expect(mockReplace).not.toHaveBeenCalled();
  expect(screen.queryByTestId('guard-loading')).toBeNull();
});

it('admin resets the PIN while the app is open: change-pin', async () => {
  useAuth.setState({
    ready: true,
    session: SESSION,
    profile: {
      role: 'driver',
      is_active: true,
      must_change_pin: false,
      full_name: 'علي',
      phone: '9647801112222',
    },
  });
  mockPathname = '/today';
  await renderScreen(<AuthGuard />);
  await act(() =>
    useAuth.setState((s) => ({ profile: s.profile && { ...s.profile, must_change_pin: true } })),
  );
  expect(mockReplace).toHaveBeenCalledWith('/auth/change-pin');
});
