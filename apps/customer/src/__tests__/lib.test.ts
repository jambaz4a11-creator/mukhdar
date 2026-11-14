import * as Sentry from '@sentry/react-native';
import { isSupabaseConfigured } from '../config';
import { ensureRTL, RTL_RELOAD_KEY, type RtlDeps } from '../lib/rtl';
import { captureError, initSentry, isSentryEnabled, wrapRoot } from '../lib/sentry';

jest.mock('@sentry/react-native', () => ({
  init: jest.fn(),
  captureException: jest.fn(),
  wrap: jest.fn((c: unknown) => ({ wrapped: c })),
}));

describe('sentry', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is a complete no-op when the DSN is empty', () => {
    expect(initSentry('')).toBe(false);
    expect(initSentry('   ')).toBe(false);
    expect(isSentryEnabled()).toBe(false);
    captureError(new Error('x'));
    const Root = () => null;
    expect(wrapRoot(Root)).toBe(Root);
    expect(Sentry.init).not.toHaveBeenCalled();
    expect(Sentry.captureException).not.toHaveBeenCalled();
    expect(Sentry.wrap).not.toHaveBeenCalled();
  });

  it('initialises and reports when a DSN is set', () => {
    expect(initSentry('https://key@o1.ingest.sentry.io/1')).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://key@o1.ingest.sentry.io/1', sendDefaultPii: false }),
    );
    const err = new Error('boom');
    captureError(err);
    expect(Sentry.captureException).toHaveBeenCalledWith(err);
    initSentry(''); // يرجع للحالة المعطّلة
  });
});

describe('ensureRTL', () => {
  function deps(isRTL: boolean, stored: string | null, now = 100_000) {
    const store = new Map<string, string>(stored ? [[RTL_RELOAD_KEY, stored]] : []);
    const d: RtlDeps & { reload: jest.Mock } = {
      i18n: { allowRTL: jest.fn(), forceRTL: jest.fn(), isRTL },
      storage: {
        getItem: jest.fn(async (k: string) => store.get(k) ?? null),
        setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      } as unknown as RtlDeps['storage'],
      reload: jest.fn(async () => undefined),
      now: () => now,
    };
    return d;
  }

  it('already RTL: forces RTL and does not reload', async () => {
    const d = deps(true, null);
    expect(await ensureRTL(d)).toBe('ok');
    expect(d.i18n.forceRTL).toHaveBeenCalledWith(true);
    expect(d.reload).not.toHaveBeenCalled();
  });

  it('LTR on first launch: forces RTL and reloads once', async () => {
    const d = deps(false, null);
    expect(await ensureRTL(d)).toBe('reloading');
    expect(d.reload).toHaveBeenCalledTimes(1);
  });

  it('still LTR right after a reload: gives up instead of looping', async () => {
    const d = deps(false, String(100_000 - 5_000));
    expect(await ensureRTL(d)).toBe('gave-up');
    expect(d.reload).not.toHaveBeenCalled();
  });
});

describe('config', () => {
  it('needs an https URL and a key', () => {
    expect(
      isSupabaseConfigured({ supabaseUrl: '', supabaseKey: 'k', sentryDsn: '', shopWhatsapp: '' }),
    ).toBe(false);
    expect(
      isSupabaseConfigured({
        supabaseUrl: 'https://x.supabase.co',
        supabaseKey: '',
        sentryDsn: '',
        shopWhatsapp: '',
      }),
    ).toBe(false);
    expect(
      isSupabaseConfigured({
        supabaseUrl: 'https://x.supabase.co',
        supabaseKey: 'sb_publishable_x',
        sentryDsn: '',
        shopWhatsapp: '',
      }),
    ).toBe(true);
  });
});
