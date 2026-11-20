// الجذر: الخط، RTL، الجلسة والحارس (SPEC-driver §2.1)، ثم التنقل. حماية بناء production الموجّه لمشروع التطوير (T23 L8).
import { useFonts } from '@expo-google-fonts/ibm-plex-sans-arabic/useFonts';
import { IBMPlexSansArabic_400Regular } from '@expo-google-fonts/ibm-plex-sans-arabic/400Regular';
import { IBMPlexSansArabic_500Medium } from '@expo-google-fonts/ibm-plex-sans-arabic/500Medium';
import { IBMPlexSansArabic_600SemiBold } from '@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold';
import { IBMPlexSansArabic_700Bold } from '@expo-google-fonts/ibm-plex-sans-arabic/700Bold';
import { isProductionOnDevBackend } from '@mukhdar/shared';
import Constants from 'expo-constants';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { config } from '../config';
import { AuthGuard } from '../features/auth/AuthGuard';
import { initAuth } from '../features/auth/store';
import { NotificationsBridge } from '../features/notifications/NotificationsBridge';
import { ar } from '../i18n/ar';
import { configureNotificationHandler } from '../lib/push';
import { ensureRTL } from '../lib/rtl';
import { getSupabase } from '../lib/supabase';
import { colors, spacing } from '../theme';

void SplashScreen.preventAutoHideAsync();
configureNotificationHandler();

function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });
  const [rtlReady, setRtlReady] = useState(false);

  // الجلسة المحفوظة + الطلب المحفوظ + onAuthStateChange + التجديد والتحديث عند الرجوع للتطبيق
  useEffect(() => initAuth(getSupabase()), []);

  useEffect(() => {
    ensureRTL()
      .then((result) => {
        if (result !== 'reloading') setRtlReady(true);
      })
      .catch(() => setRtlReady(true));
  }, []);

  // خطأ تحميل الخط لا يوقف التطبيق: يكمل بخط النظام
  const ready = (fontsLoaded || fontError !== null) && rtlReady;
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      >
        {/* الشاشات الإجبارية: بلا سحب للرجوع */}
        <Stack.Screen name="auth/change-pin" options={{ gestureEnabled: false }} />
        <Stack.Screen name="auth/not-driver" options={{ gestureEnabled: false }} />
        <Stack.Screen name="auth/offline" options={{ gestureEnabled: false }} />
        <Stack.Screen name="auth/pending" options={{ gestureEnabled: false }} />
        <Stack.Screen name="auth/set-pin" options={{ gestureEnabled: false }} />
      </Stack>
      <AuthGuard />
      <NotificationsBridge />
    </SafeAreaProvider>
  );
}

export default function Root() {
  const appEnv = (Constants.expoConfig?.extra as { appEnv?: string } | undefined)?.appEnv;
  if (isProductionOnDevBackend(appEnv, config.supabaseUrl)) {
    return (
      <View testID="build-config-error" style={styles.configError}>
        <AppText weight="bold" size="title">
          {ar.common.buildConfigErrorTitle}
        </AppText>
        <AppText muted>{ar.common.buildConfigErrorBody}</AppText>
      </View>
    );
  }
  return <RootLayout />;
}

const styles = StyleSheet.create({
  configError: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.screen },
});
