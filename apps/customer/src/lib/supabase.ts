// Supabase client واحد للتطبيق (من @mukhdar/shared) بجلسة محفوظة على AsyncStorage.
import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createSupabaseClient, type MukhdarClient } from '@mukhdar/shared';
import { config, isSupabaseConfigured } from '../config';

let client: MukhdarClient | null = null;

/** null إن لم يُضبط .env (الرئيسية تعرض رسالة بدل الانهيار). */
export function getSupabase(): MukhdarClient | null {
  if (!isSupabaseConfigured()) return null;
  client ??= createSupabaseClient({
    url: config.supabaseUrl,
    anonKey: config.supabaseKey,
    storage: AsyncStorage,
  });
  return client;
}
