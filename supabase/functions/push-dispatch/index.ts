// Edge Function: push-dispatch
// تُستدعى من القاعدة (trigger بعد insert بـ notification_outbox، و pg_cron كل دقيقة) عبر pg_net.
// المفاتيح تحقنها Supabase تلقائياً (keys.ts). EXPO_ACCESS_TOKEN اختياري. verify_jwt = false: التفويض بسر
// x-dispatch-secret (Vault) لا بمفتاح.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { dispatchAll, type OutboxRow, type RowResult, type Store } from './dispatch.ts';
import { createExpoSender } from './expo.ts';
import { createHandler } from './handler.ts';
import { keyKind, secretKey, supabaseUrl } from '../_shared/keys.ts';

// T23 F H2: المفتاح الجديد (SUPABASE_SECRET_KEYS) أولاً، والقديم (SUPABASE_SERVICE_ROLE_KEY) احتياطاً
const url = supabaseUrl();
const key = secretKey();
console.log('keys', JSON.stringify({ secret: keyKind(key) })); // النوع فقط، لا القيمة

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const store: Store = {
  async claim(limit) {
    const { data, error } = await db.rpc('claim_push_notifications', { p_limit: limit });
    if (error) throw new Error(`claim: ${error.message}`);
    return (data ?? []) as OutboxRow[];
  },
  async finish(results: RowResult[], deadTokens: string[]) {
    const { error } = await db.rpc('finish_push_notifications', {
      p_results: results,
      p_dead_tokens: deadTokens,
    });
    if (error) throw new Error(`finish: ${error.message}`);
  },
};

const senders = { expo: createExpoSender({ accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') }) };

Deno.serve(
  createHandler({
    async authorize(secret) {
      const { data, error } = await db.rpc('push_dispatch_authorized', { p_secret: secret });
      if (error) throw new Error(`authorize: ${error.message}`);
      return data === true;
    },
    run: () => dispatchAll(store, senders),
    log: (msg, extra) => console.log(msg, JSON.stringify(extra ?? null)),
  }),
);
