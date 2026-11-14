// الجذر: Sentry (إن وُجد DSN)، الخط، RTL، الجلسة (T10)، TanStack Query المحفوظ، ثم التنقل.
import { useFonts } from '@expo-google-fonts/ibm-plex-sans-arabic/useFonts';
import { IBMPlexSansArabic_400Regular } from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular';
import { IBMPlexSansArabic_500Medium } from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold';
import { IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic/700Bold';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initAuth } from '../features/auth/store';
import { createQueryClient, PERSIST_MAX_AGE, queryPersister } from '../lib/query';
import { ensureRTL } from '../lib/rtl';
import { captureError, initSentry, wrapRoot } from '../lib/sentry';
import { getSupabase } from '../lib/supabase';
import { colors } from '../theme';

initSentry();
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
        persistOptions={{ persister: queryPersister, maxAge: PERSIST_MAX_AGE }}
      >
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </PersistQueryClientProvider>
    </SafeAreaProvider>
  );
}

export default wrapRoot(RootLayout);
