#!/usr/bin/env node
// Live CORS check (bug 2026-11-23): every Edge Function the browser calls must answer the preflight from
// every deployed web origin with 204 + Access-Control-Allow-Origin = that origin. A 403 here means the
// ALLOWED_ORIGINS secret lost an origin, and the app shows "can't connect" (FunctionsFetchError).
// Read-only: OPTIONS requests only, no body, no key, no account.
//   node scripts/cors-live-check.mjs                     # mukhdar-dev + the three deployed origins
//   CORS_BASE_URL=https://<ref>.supabase.co CORS_ORIGINS=https://a,https://b node scripts/cors-live-check.mjs
import { pathToFileURL } from 'node:url';

export const DEFAULT_BASE_URL = 'https://ghcohlrzvehtcettaaiu.supabase.co';
export const DEFAULT_ORIGINS = [
  'https://mukhdar-app.pages.dev',
  'https://mukhdar-driver.pages.dev',
  'https://mukhdar-admin.jambaz4a11.workers.dev',
];
/** Functions called from a browser (push-dispatch is server-to-server and has no CORS). */
export const BROWSER_FUNCTIONS = [
  'signup',
  'delete-account',
  'driver-register',
  'driver-complete-registration',
  'admin-reset-pin',
  'admin-create-user',
  // T44: مفتاح VAPID العام للوحة الأدمن
  'push-config',
];

/** One preflight per (function, origin). Returns rows with ok=false for anything but 204 + echo. */
export async function checkCors({
  baseUrl = DEFAULT_BASE_URL,
  origins = DEFAULT_ORIGINS,
  functions = BROWSER_FUNCTIONS,
  fetchImpl = fetch,
} = {}) {
  const rows = [];
  for (const fn of functions) {
    for (const origin of origins) {
      let status;
      let allow = null;
      try {
        const res = await fetchImpl(`${baseUrl}/functions/v1/${fn}`, {
          method: 'OPTIONS',
          headers: {
            Origin: origin,
            'Access-Control-Request-Method': 'POST',
            'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info',
          },
        });
        status = res.status;
        allow = res.headers.get('access-control-allow-origin');
      } catch {
        status = 0;
      }
      rows.push({ fn, origin, status, ok: status === 204 && allow === origin });
    }
  }
  return rows;
}

async function main() {
  const baseUrl = process.env.CORS_BASE_URL || DEFAULT_BASE_URL;
  const origins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_ORIGINS;
  const rows = await checkCors({ baseUrl, origins });
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.status} ${r.fn} ← ${r.origin}`);
  const bad = rows.filter((r) => !r.ok);
  if (bad.length) {
    console.error(
      `\n${bad.length} preflight(s) failed: ALLOWED_ORIGINS on ${baseUrl} is missing an origin (RUNBOOK §16f).`,
    );
    process.exit(1);
  }
  console.log(`\nAll ${rows.length} preflights ok.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
