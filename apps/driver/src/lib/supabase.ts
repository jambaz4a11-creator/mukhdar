// Supabase client واحد للتطبيق (من @mukhdar/shared) بجلسة محفوظة بـ expo-secure-store. المفتاح المنشور فقط.
import 'react-native-url-polyfill/auto';
import { createSupabaseClient, type MukhdarClient } from '@mukhdar/shared';
import { config, isSupabaseConfigured } from '../config';
import { secureStorage } from './secureStorage';

let client: MukhdarClient | null = null;

/** null إن لم يُضبط .env (الشاشات تعرض رسالة بدل الانهيار). */
export function getSupabase(): MukhdarClient | null {
  if (!isSupabaseConfigured()) return null;
  client ??= createSupabaseClient({
    url: config.supabaseUrl,
    anonKey: config.supabaseKey,
    storage: secureStorage,
  });
  return client;
}
