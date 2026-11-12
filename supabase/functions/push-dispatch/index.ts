// Edge Function: push-dispatch
// تُستدعى من القاعدة (trigger بعد insert بـ notification_outbox، و pg_cron كل دقيقة) عبر pg_net.
// SUPABASE_URL و SUPABASE_SERVICE_ROLE_KEY تحقنهما Supabase تلقائياً. EXPO_ACCESS_TOKEN اختياري.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { dispatchAll, type OutboxRow, type RowResult, type Store } from './dispatch.ts';
import { createExpoSender } from './expo.ts';
import { createHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');

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
