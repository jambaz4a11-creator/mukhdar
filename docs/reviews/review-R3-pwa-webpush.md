# Review R3: driver PWA and Web Push (T34–T38)

- **Date:** 2026-11-22. **Scope:** the R3 row of `docs/tasks/00-README.md` (`docs/tasks/R3-pwa-webpush-review.md`), i.e.
  what T34–T38 merged on `main` up to `f137235` (PRs #26–#31):
  - T34 `packages/shared/src/webSecureStorage.ts`, `apps/*/src/lib/secureStorage.web.ts`, `apps/driver/src/lib/secureStore.web.ts`
  - T35 `supabase/functions/push-dispatch/{webpush,webpush_crypto,dispatch,index}.ts`
  - T36 migrations `20261210000001_webpush_enums.sql`, `20261210000002_webpush_db.sql`, `supabase/tests/37_webpush_db.sql`
  - T37 driver web export, `public/{_headers,manifest.webmanifest}`, install gate, `scripts/web-{csp,postexport}.mjs`,
    `scripts/check-web-bundle.mjs`, the `web-builds` CI job
  - T38 `packages/shared/src/webPush.ts`, both `public/sw.js`, `push.web.ts`, `webPushController.ts`,
    `PushPrompt.web.tsx`, `NotificationsBridge.web.tsx`, every sign-out path in both apps
- **T39 (real devices) is not done yet**, so item 10's "T39 report against SPEC-webpush §10" is still open. T38 stays 🟡
  until the owner's desktop Chrome check.
- **Method (read-only):** I read the code against SPEC-webpush §3–§6 and §10, SPEC-backend, RUNBOOK §16f/§16g and the
  task files. On mukhdar-dev I ran read-only catalog queries: function `EXECUTE` grants, `push_tokens` policies and
  table grants, the `webpush` rows (count only) and the live `set_order_status` source. I ran `migration list` and
  checked the deployed headers of both Pages sites with `curl -I`. I grepped the repo for the owner's e-mail and for
  VAPID private keys.
- **Nothing changed in code, migrations, Edge Functions or the cloud.** This file and the R3 status lines are the
  only changes.

## Test results (one package at a time, `--maxWorkers=2`)

| Suite | Result |
|---|---|
| `@mukhdar/shared` Jest | 374 / 374 |
| `@mukhdar/driver` Jest | 326 / 326 |
| `@mukhdar/customer` Jest | 281 / 281 |
| Deno (`pnpm test:functions`, check + test) | 176 / 176 |
| `node --test scripts/seed-guard.test.mjs` | 13 / 13 |
| pgTAP (`db-tests`), driver PWA Playwright WebKit + Chromium (`web-builds`), `admin-e2e` | green in CI on `main` (PR #32 run) |
| `pnpm sb migration list --remote` | local = remote, **41 = 41** |

## Summary

The core security model holds:

- **SSRF:** the endpoint allowlist is enforced three times (table CHECK, `register_web_push`, the sender), all
  anchored right after `https://` with `/` required after the host. The database copy is stricter than the sender
  (lower case only, no `:443`, no trailing dot, printable ASCII). `@`, user-info, ports, IDN tricks and
  `host.evil.com` don't get through. The sender uses `redirect: 'manual'`, an 8 s timeout, a 1 KB payload cap, and
  never puts the URL in errors or logs.
- **RLS and grants on dev:** `register_web_push` runs for `authenticated` only (not `anon`).
  `claim_push_notifications` and `finish_push_notifications` run for `service_role` only, so `keys` never reach a
  client. `push_tokens` gives `authenticated` SELECT/DELETE on its own rows only. `must_change_pin`, inactive users
  and admin/staff without a live aal2 session are excluded when recipients are claimed. `register_push_token`
  (Expo) is unchanged.
- **Secrets:** there is no VAPID private key and no owner e-mail in any file. `VAPID_SUBJECT` exists only as an Edge
  secret, and the bundle scan fails the build if a secret is found.
- **CSP:** the deployed `script-src` is `'self'` only (no inline scripts, no `unsafe-inline`), with
  `frame-ancestors 'none'`, `object-src 'none'` and `worker-src 'self'`. `sw.js` is served `no-cache` on both origins.
- **Service workers:** both always show a notification, whatever the payload (the iOS rule). Clicks are only routed
  through a whitelist that matches `routeForNotification`, and a parity test checks that. Nothing else from the
  payload is kept.
- **Sign-out:** every path in both apps deletes the row first, then calls `unsubscribe()`. Offline, the row delete is
  deferred and stored encrypted, and RLS stops a deferred delete from removing another account's live row.

The findings are robustness gaps and one privacy leak that started before these tasks and now also reaches the web
path. **No Critical, no High.**

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 4 |
| Low | 9 |

## Medium

### M1. The driver's "order cancelled" push shows the free-text cancel reason
`set_order_status` (live on dev, latest definition `20261205000001`) notifies the assigned driver with
`body = coalesce(v_reason, 'بلوك X - بناية Y')`. The reason is typed by an admin or staff member (up to 300
characters). It can contain the customer's phone number, floor or apartment, and it then appears on the lock screen
through Expo (where FCM/APNs see the plain text) and through Web Push. The privacy tests (`03_place_order`,
`04_status_transitions`) never cancel with a reason, so they can't catch it. This breaks SPEC-webpush §5.5 /
SPEC-backend ("block and building only"). It is older than T34–T38, but R3 item 3 covers it.
**Fix:** new migration. The driver's cancel body is always `بلوك X - بناية Y` (the reason stays on the order and in
the app). Add a pgTAP case that cancels with a phone- and apartment-like reason and asserts the outbox stays clean.

### M2. An existing subscription is reused even if it was made with another VAPID key
`createWebPush().register()` takes `pushManager.getSubscription()` as-is. If that subscription was created with a
different `applicationServerKey`, every send gets HTTP 403. This happens after a key change, after a dev/prod mix-up,
or with a subscription left from a test build. The sender correctly classifies 403 as a *permanent failure, token
kept*, so the device silently gets nothing, forever, and every outbox row records a failure. Nothing on the client
notices.
**Fix:** compare `subscription.options.applicationServerKey` with the configured key. If they differ, call
`unsubscribe()` and subscribe again (permission is already granted). Test both cases: key matches and key differs.

### M3. Web secure storage never recovers from a closed or lost IndexedDB connection
The backend is opened once and cached. If the connection closes, every later read or write throws: `onversionchange`
closes it, the browser can fire `close`, and WebKit can lose its IndexedDB server connection after a PWA has been in
the background. `getItem` then returns `null` for everything, so the driver PWA looks signed out and its registration
looks gone until the page reloads, and `setItem` of a refreshed session is lost. iOS is exactly the target of T37.
**Fix:** when a transaction fails with `InvalidStateError` / `UnknownError` (or on the `close` event), drop the
cached backend and retry the operation once against a fresh `open()`. A fresh connection still finds the same key in
IndexedDB, so nothing is cleared. Jest test with `fake-indexeddb`: close the database, then read again.

### M4. No warning when storage falls back to memory only
SPEC-webpush §6.3 says "memory only + a warning banner". `isSessionStorageDegraded()` exists in both apps, but
nothing calls it. A driver who registers in private mode, or where IndexedDB is blocked, loses the device secret
(and the session) as soon as the tab closes, with no warning.
**Fix:** an Arabic banner in both apps while degraded (driver: on the auth/registration screens and in the app shell;
customer: in the app shell). Test both states.

## Low

- **L1. Losing the session without signing out leaves the subscription bound to the old account.** If the refresh
  token is revoked or expires (`SIGNED_OUT` without `signOut()`), there is no session left to delete the row. The
  device then keeps getting that account's notifications (if it is still active and has no `must_change_pin`) until
  someone else signs in. The same is true after the customer deletes their account: the server rows cascade, but
  the browser subscription stays. **Fix:** on a `SIGNED_OUT` event, call a local-only `unsubscribe()` (the push
  service then answers 410 and the sender deletes the row). This applies to both apps.
- **L2. The customer SW tag is per status (`status:order_id`).** Each status of the same order stacks a new
  notification. SPEC §5.2 intends one notification per order. **Fix:** tag = `order:<order_id>` for the customer
  (`renotify` stays). The `Topic` header already replaces undelivered ones on the server side.
- **L3. A click can be lost if `focus()` rejects.** In `notificationclick`, the `postMessage` hangs off
  `focus().then(...)`, so if focus is refused nothing navigates. **Fix:** catch it and fall back to
  `openWindow(route)`.
- **L4. The app re-registers on every return to the foreground.** Each `visibilitychange` sends one
  `register_web_push` RPC and one row update. **Fix:** skip the RPC when this run has already registered the same
  endpoint less than an hour ago. The local `getSubscription()` check stays.
- **L5. The host allowlist is written three times with no parity test.** It is consistent today. **Fix:** a Deno test
  that runs one corpus through `isAllowedEndpoint` and through the migration's regex (read from the SQL file), and
  checks that the DB never accepts what the sender rejects.
- **L6. Two iOS "needs install" detectors.** The customer's `needsInstall()` duplicates the driver's `installState`
  iOS logic (UA + iPadOS touch + standalone). **Fix:** one shared pure function in `packages/shared`, used by both
  apps and tested once.
- **L7. The customer PWA has no Playwright in CI.** The driver PWA runs static WebKit + Chromium specs in
  `web-builds`. The customer's manifest, headers, `sw.js` and CSP are only checked locally (its e2e specs need a live
  backend). **Fix:** a backend-free `static.spec.ts` for the customer (manifest, `_headers` CSP without
  `unsafe-inline`, `sw.js` no-cache, no CSP console errors, RTL), run in `web-builds`.
- **L8. The `ALLOWED_ORIGINS` docs disagree with each other.** RUNBOOK §17 says production = the admin origin only.
  §16f says admin + driver PWA. The R3 checklist says "the two origins only". The customer PWA also calls
  browser-facing functions (`signup`, `delete-account`), so a production customer web app would need its origin
  too. Dev's 5 origins (2× localhost, admin, customer, driver) are correct for dev. **Fix:** one statement in §16f/§17
  (admin + driver, + customer if the customer web app goes to production), with the open decision recorded in
  `docs/OPEN-QUESTIONS.md`.
- **L9. Hygiene in the SW and the controller (no behaviour change).** In `remove()`, if the deferred-delete write
  fails, the code continues silently. That is fine (unsubscribe is the guarantee), but nothing tests it. **Fix:** add
  a test that `remove()` still unsubscribes when storage throws.

## Ordered fix list (separate PR)

1. **M1:** migration (driver cancel body = block + building only) + pgTAP with a phone/apartment-like reason.
   `db push` on mukhdar-dev after the dry run, lists must match, RUNBOOK §17 row 42.
2. **M2:** re-subscribe when the VAPID key differs (`packages/shared/webPush.ts`) + tests.
3. **M3:** reopen IndexedDB after a closed or lost connection, retry once (`webSecureStorage.ts`) + tests.
4. **M4:** memory-only warning banner in both apps + tests.
5. **L1:** local `unsubscribe()` on a passive `SIGNED_OUT` (both apps) + tests.
6. **L2 + L3:** customer SW tag per order; `focus()` fallback in both SWs + parity/loadSw tests.
7. **L4:** throttle the silent re-register + test.
8. **L5:** allowlist parity test (Deno).
9. **L6:** shared iOS needs-install detector.
10. **L7:** customer static Playwright spec in CI.
11. **L8:** docs (`ALLOWED_ORIGINS` per environment) + OPEN-QUESTIONS.
12. **L9:** `remove()` test when storage throws.

Redeploying `push-dispatch` is **not** needed for any item (M1 changes the text in the database; L5 is test-only).
No VAPID key change. No Cloudflare setting change: the Pages sites rebuild from `main` as usual.

## Fixes (2026-11-22, PR #34)
All 13 items are done, in the order above. Migration `20261211000001_r3_cancel_push_privacy.sql` was applied to
mukhdar-dev with `pnpm sb db push --remote` after the dry run and green CI; `migration list` is 42 = 42. No Edge
Function redeploy. No VAPID or Cloudflare change. Tests: shared 389, driver 332, customer 287, Deno 179, scripts 93,
pgTAP 38/38 files on dev, and the customer static Playwright now runs in CI (8/8).
