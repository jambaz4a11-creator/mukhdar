// Edge Function: push-config (T44، SPEC-admin-push §2). مفتاح VAPID العام للوحة الأدمن. بلا مفاتيح خادم ولا قاعدة بيانات.
import { createPushConfigServer } from './handler.ts';
import { parseAllowedOrigins } from '../_shared/cors.ts';

Deno.serve(
  createPushConfigServer(
    Deno.env.get('VAPID_PUBLIC_KEY'),
    parseAllowedOrigins(Deno.env.get('ALLOWED_ORIGINS')),
  ),
);
