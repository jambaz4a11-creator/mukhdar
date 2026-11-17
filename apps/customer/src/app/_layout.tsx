// الجذر: Sentry (إن وُجد DSN)، الخط، RTL، الجلسة (T10)، TanStack Query المحفوظ مع الشبكة والتركيز (S4)،
// الإشعارات (T14)، شريط بدون إنترنت، ثم التنقل.
import { useFonts } from '@expo-google-fonts/ibm-plex-sans-arabic/useFonts';
import { IBMPlexSansArabic_400Regular } from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular';
import { IBMPlexSansArabic_500Medium } from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold';
import { IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic/700Bold';
import { isProductionOnDevBackend } from '@mukhdar/shared';
import Constants from 'expo-constants';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import '../lib/webShims';
import { AppText } from '../components/AppText';
import { OfflineBanner } from '../components/OfflineBanner';
import { config } from '../config';
import { ForcedPinGuard } from '../features/auth/ForcedPinGuard';
import { initAuth } from '../features/auth/store';
import { NotificationsBridge } from '../features/notifications/NotificationsBridge';
import { configureNotificationHandler } from '../features/notifications/push';
import {
  createQueryClient,
  PERSIST_MAX_AGE,
  queryPersister,
  shouldPersistQuery,
} from '../lib/query';
import { setupQueryManagers } from '../lib/network';
import { ensureRTL } from '../lib/rtl';
import { captureError, initSentry, wrapRoot } from '../lib/sentry';
import { getSupabase } from '../lib/supabase';
import { colors } from '../theme';

initSentry();
configureNotificationHandler();
setupQueryManagers();
void SplashScreen.preventAutoHideAsync();

const queryClient = createQueryClient();

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });
  const [rtlReady, setRtlReady] = useState(false);

  // الجلسة المحفوظة + onAuthStateChange + التجديد التلقائي والتطبيق بالواجهة
  useEffect(() => initAuth(getSupabase()), []);

  useEffect(() => {
    ensureRTL()
      .then((result) => {
        if (result !== 'reloading') setRtlReady(true);
      })
      .catch((e: unknown) => {
        captureError(e);
        setRtlReady(true);
      });
  }, []);

  useEffect(() => {
    if (fontError) captureError(fontError);
  }, [fontError]);

  // خطأ تحميل الخط لا يوقف التطبيق: يكمل بخط النظام
  const ready = (fontsLoaded || fontError !== null) && rtlReady;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{
          persister: queryPersister,
          maxAge: PERSIST_MAX_AGE,
          dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
        }}
      >
        <StatusBar style="dark" />
        <NotificationsBridge />
        <OfflineBanner />
        <ForcedPinGuard />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        >
          {/* شاشة تغيير الرمز: بلا سحب للرجوع (الإجباري لا يُترك؛ العادي فيه زر رجوع) */}
          <Stack.Screen name="account/pin" options={{ gestureEnabled: false }} />
        </Stack>
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

/**
 * T23 L8: بناء production يشير لمشروع التطوير = خطأ إعداد (متغيرات بيئة EAS). لا نعرض التطبيق ولا نتصل بشيء.
 * (app.config.ts يمنع هذا أصلاً وقت البناء؛ هذه الشبكة الثانية لبناء قديم أو متغير بيئة تغيّر لاحقاً.)
 */
function Root() {
  const appEnv = (Constants.expoConfig?.extra as { appEnv?: string } | undefined)?.appEnv;
  if (isProductionOnDevBackend(appEnv, config.supabaseUrl)) {
    return (
      <View
        testID="build-config-error"
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
      >
        <AppText weight="bold" size="title">
          خطأ بإعداد التطبيق
        </AppText>
        <AppText color={colors.textMuted}>
          هذه النسخة موجّهة لخادم تجريبي. لا تستعملها، وأبلغ المطوّر.
        </AppText>
      </View>
    );
  }
  return <RootLayout />;
}

export default wrapRoot(Root);
