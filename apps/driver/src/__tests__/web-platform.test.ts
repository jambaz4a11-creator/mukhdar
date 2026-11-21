// فصل المنصات (T37، SPEC-webpush §3.1): كل وحدة لها نسخة *.web بنفس التصدير، والنسخة الويب لا تستورد وحدات أصلية.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const NATIVE_ONLY = [
  'expo-notifications',
  'expo-device',
  'expo-updates',
  'expo-secure-store',
  'expo-dev-client',
];

const PAIRS: [native: string, web: string][] = [
  ['lib/push', 'lib/push.web'],
  ['lib/rtl', 'lib/rtl.web'],
  ['lib/secureStorage', 'lib/secureStorage.web'],
  ['lib/secureStore', 'lib/secureStore.web'],
  ['features/notifications/NotificationsBridge', 'features/notifications/NotificationsBridge.web'],
  ['features/notifications/PushPrompt', 'features/notifications/PushPrompt.web'],
];

function source(rel: string): string {
  for (const ext of ['.ts', '.tsx']) {
    try {
      return readFileSync(join(SRC, rel + ext), 'utf8');
    } catch {
      // التالي
    }
  }
  throw new Error(`missing ${rel}`);
}

/** أسماء التصدير من النص (أسرع وأوثق من require لوحدات أصلية مُحاكاة). */
function exportedNames(code: string): string[] {
  const names = new Set<string>();
  for (const m of code.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let|class|type|interface)\s+(\w+)/g,
  )) {
    names.add(m[1] as string);
  }
  // export { a, b as c } / export type { T }
  for (const m of code.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const part of (m[1] as string).split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

describe.each(PAIRS)('%s ↔ %s', (nativeRel, webRel) => {
  it('the web file exports every name the native file exports', () => {
    const missing = exportedNames(source(nativeRel)).filter(
      (n) => !exportedNames(source(webRel)).includes(n),
    );
    expect(missing).toEqual([]);
  });

  it('the web file imports no native-only module', () => {
    const code = source(webRel);
    for (const mod of NATIVE_ONLY) expect(code).not.toContain(`'${mod}`);
  });
});

describe('push.web (until T38)', () => {
  it('reports unsupported and never touches the network', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const push = require('../lib/push.web') as typeof import('../lib/push.web');
    const client = { rpc: jest.fn(), from: jest.fn() } as never;
    expect(push.canUseRemotePush()).toBe(false);
    await expect(push.getPermissionState()).resolves.toBe('unavailable');
    await expect(push.registerPushToken(client, { ask: true })).resolves.toBe('unsupported');
    await expect(push.getExpoPushTokenIfAllowed()).resolves.toBeNull();
    await expect(push.unregisterPushToken(client)).resolves.toBe(true);
    await expect(push.removePushForSignOut(client)).resolves.toBeUndefined();
    await expect(push.retryPendingPushUnregister(client)).resolves.toBeUndefined();
    expect((client as { rpc: jest.Mock }).rpc).not.toHaveBeenCalled();
    expect((client as { from: jest.Mock }).from).not.toHaveBeenCalled();
  });
});

describe('rtl.web', () => {
  it('sets dir="rtl" and lang="ar" on <html> without reloading', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ensureRTL } = require('../lib/rtl.web') as typeof import('../lib/rtl.web');
    const el = { dir: 'ltr', lang: 'en' };
    (globalThis as { document?: unknown }).document = { documentElement: el };
    try {
      await expect(ensureRTL()).resolves.toBe('ok');
      expect(el).toEqual({ dir: 'rtl', lang: 'ar' });
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });
});
