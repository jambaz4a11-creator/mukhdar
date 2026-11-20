// T30 الخطوة 1: الثيم مطابق لتطبيق الزبون، الإعداد، حماية بناء production، وملف النصوص.
import { colors, fonts, fontSizes, radius, sizes, spacing } from '../theme';
import * as customerTheme from '../../../customer/src/theme';
import { isSupabaseConfigured } from '../config';
import { ar } from '../i18n/ar';

describe('theme', () => {
  it('same values as the customer app (SPEC-driver §1)', () => {
    expect({ colors, fonts, fontSizes, radius, sizes, spacing }).toEqual({
      colors: customerTheme.colors,
      fonts: customerTheme.fonts,
      fontSizes: customerTheme.fontSizes,
      radius: customerTheme.radius,
      sizes: customerTheme.sizes,
      spacing: customerTheme.spacing,
    });
  });

  it('primary buttons are at least 52px (used while walking/driving)', () => {
    expect(sizes.primaryButton).toBeGreaterThanOrEqual(52);
  });
});

describe('config', () => {
  it('needs an https URL and a key', () => {
    expect(isSupabaseConfigured({ supabaseUrl: '', supabaseKey: 'k' })).toBe(false);
    expect(isSupabaseConfigured({ supabaseUrl: 'http://x', supabaseKey: 'k' })).toBe(false);
    expect(isSupabaseConfigured({ supabaseUrl: 'https://x.supabase.co', supabaseKey: '' })).toBe(
      false,
    );
    expect(isSupabaseConfigured({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'k' })).toBe(
      true,
    );
  });
});

describe('app.config.ts', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.resetModules();
  });

  function load() {
    let cfg: unknown;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../../app.config') as { default: (c: { config: object }) => unknown };
      cfg = mod.default({ config: {} });
    });
    return cfg as {
      name: string;
      android: { package: string; allowBackup: boolean };
      ios: { bundleIdentifier: string };
    };
  }

  it('driver identity, no Android backup', () => {
    const cfg = load();
    expect(cfg.name).toBe('سائق المخضر');
    expect(cfg.android.package).toBe('com.mukhdar.driver');
    expect(cfg.ios.bundleIdentifier).toBe('com.mukhdar.driver');
    expect(cfg.android.allowBackup).toBe(false);
  });

  it('refuses a production build pointing at mukhdar-dev (T23 L8)', () => {
    process.env.APP_ENV = 'production';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://ghcohlrzvehtcettaaiu.supabase.co';
    expect(load).toThrow(/mukhdar-dev/);
  });
});

describe('i18n', () => {
  it('no empty string', () => {
    const walk = (v: unknown): string[] =>
      typeof v === 'string' ? [v] : Object.values(v as object).flatMap(walk);
    expect(walk(ar).filter((s) => s.trim() === '')).toEqual([]);
  });
});
