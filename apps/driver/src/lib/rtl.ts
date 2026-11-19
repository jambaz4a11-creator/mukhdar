// فرض RTL (T09). بالبناء يفرضه expo-localization (forcesRTL) أصلياً. في Expo Go تفضيل RTL
// يُعاد ضبطه عند فتح المشروع، لذلك: forceRTL ثم إعادة تحميل مرة واحدة إن كان الاتجاه ما زال LTR.
// حماية من الحلقة: لا إعادة تحميل ثانية خلال 30 ثانية (إن لم ينجح الفرض نكمل بدل التكرار).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { DevSettings, I18nManager } from 'react-native';

export const RTL_RELOAD_KEY = 'mukhdar.driver.rtlReloadAt';
const RELOAD_GUARD_MS = 30_000;

export type RtlResult = 'ok' | 'reloading' | 'gave-up';

export interface RtlDeps {
  i18n: Pick<typeof I18nManager, 'allowRTL' | 'forceRTL' | 'isRTL'>;
  storage: Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
  reload: () => Promise<void>;
  now: () => number;
}

async function reloadApp(): Promise<void> {
  try {
    await Updates.reloadAsync();
  } catch {
    DevSettings.reload();
  }
}

const defaultDeps: RtlDeps = {
  i18n: I18nManager,
  storage: AsyncStorage,
  reload: reloadApp,
  now: () => Date.now(),
};

export async function ensureRTL(deps: RtlDeps = defaultDeps): Promise<RtlResult> {
  deps.i18n.allowRTL(true);
  deps.i18n.forceRTL(true);
  if (deps.i18n.isRTL) return 'ok';

  const last = Number((await deps.storage.getItem(RTL_RELOAD_KEY)) ?? 0);
  if (deps.now() - last < RELOAD_GUARD_MS) return 'gave-up';
  await deps.storage.setItem(RTL_RELOAD_KEY, String(deps.now()));
  await deps.reload();
  return 'reloading';
}
