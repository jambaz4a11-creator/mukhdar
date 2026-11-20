# Review R2: driver delivery, today, account and push (T31–T32), plus a re-check of R1

- **Date:** 2026-11-21. **Scope:** the R2 row of `docs/tasks/00-README.md`, i.e. what T31 and T32 merged on `main` at
  `9f6dac8` (PR #20, PR #21), with a re-check that the R1 fixes (PR #19, migration `20261209000001`) still hold:
  - `apps/driver/src/features/orders/*` (`available`, `mine`, `detail`, `transitions`, `driverErrors`,
    `useFocusedPoll`), the screens `(tabs)/index`, `(tabs)/my-orders`, `order/[id]`
  - `features/today/*`, `(tabs)/today`, `packages/shared/src/baghdadDay.ts`
  - `features/account/account.ts`, `(tabs)/account`, `account/change-pin`, every other sign-out path
    (`auth/offline`, `auth/not-driver`, `auth/change-pin`)
  - `lib/push.ts`, `features/notifications/*` (`NotificationsBridge`, `routing`, `events`)
  - `features/auth/store.ts` and `guard.ts` (R1 M2 / L6)
  - `app.config.ts`, `eas.json`, `.env.example`, `.gitignore`, `.github/workflows/ci.yml`
- **Method (read-only):** I read the code by hand against SPEC-driver §2.1 and §2.6–§2.11, DRIVER-API §3–§6 and §8,
  SPEC-backend, RUNBOOK §16b–§16e and the R1 report. I checked the installed `@supabase/realtime-js` 2.119.0 source
  for how channels behave. I grepped the local Android bundle (`apps/driver/dist-check`, git-ignored) for keys. I ran
  the driver Jest suite. On mukhdar-dev I ran read-only catalog queries only: migration list, RLS policies on `orders`,
  `order_items`, `order_status_history`, `profiles` and `push_tokens`, table grants, the `supabase_realtime`
  publication, the result columns of `available_orders`, and function `EXECUTE` grants plus R1 markers in the source
  of `set_user_role`, `decide_driver_request` and `finish_driver_registration`.
- **Nothing changed in code, migrations, Edge Functions or the cloud.** This file and the R2 status line are the only
  changes.

## Summary

The security model holds. A driver can't see another driver's order or any customer data before accepting: the
data is gated by RLS, not by the app. Accepting is atomic on the server. Push payloads carry no more than the ready
list shows. Today's cash math is correct at the Baghdad midnight edges. The app bundle contains only public values.

There is **one ship-blocking bug that the tests can't see**, and two things to settle before the APK:

1. **Critical C1. Opening an order crashes the app whenever "My orders" is mounted.** Both screens subscribe to the
   same Realtime topic. supabase-js returns the already-joined channel for that topic, and `.on()` on a joined
   channel throws. The Jest fake creates a new channel on every call, so the tests don't catch it.
2. **Medium M1. The T33 `preview` APK will probably build without its configuration.** The `EXPO_PUBLIC_*` values,
   `GOOGLE_SERVICES_JSON` and the EAS project id were set up for the EAS `development` environment only, and
   `eas.json` doesn't say which environment `preview` uses.
3. **Medium M2. Three of the four sign-out paths leave this device's push token on the server.** The offline screen
   is the worst case: the device keeps getting that driver's pushes after signing out.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 0 |
| Medium | 2 |
| Low | 6 |

## Where we are

- T01–T20, T22, T23 and T25–T31 are ✅. T21 was cancelled (replaced by T27–T33). T04 is optional. T24 (release) is ⬜.
- T32 is 🟡: code and tests are done. The EAS project, the Firebase Android app, `GOOGLE_SERVICES_JSON`, the FCM V1
  key and a development build exist. The on-device push and screen checks moved to T33.
- **R2 (this review) is the gate before T33** (APK + two real Android devices). Next: the fix list below (app code
  plus EAS environment setup; no migration, no Edge Function), then T33.
- mukhdar-dev: 39 migrations, the same 39 as `supabase/migrations` (last `20261209000001_r1_driver_fixes`).
  `pnpm sb migration list --remote` should show nothing pending. `driver_requests` is empty.
- CI on `main`: green for the last three merges (PR #19, #20, #21). Locally, `jest --runInBand` in `apps/driver` passes
  **21 suites / 216 tests**. The default parallel run on this Windows machine fails with "Jest worker ran out of
  memory" (see L6). That is a local environment problem, not a test failure.

## Checked and OK (evidence)

| Area | Result |
|---|---|
| No access before accept (RLS) | dev `orders_read`: a driver sees a row only if `driver_id = auth.uid()` **and** `current_user_role() = 'driver'` (which is null while `must_change_pin`, and requires `is_active`). `order_items_read` and `order_history_read` go through `orders`. `profiles_read_own` allows only the user's own row (or an admin). `authenticated` has only `SELECT` on `orders`, and `SELECT, DELETE` on `push_tokens`. No insert or update. |
| Ready list carries no customer data | dev `available_orders` returns `id, order_number, status, sector, subsection, building, item_count, line_count, total_iqd, created_at`: no name, phone, floor, apartment or note. `ReadyOrderCard` renders only those. |
| Realtime can't leak | Only `public.orders` is in `supabase_realtime`, and Realtime applies RLS per subscriber. The `driver_id=eq.<me>` filter only narrows: a modified client that drops the filter still gets only its own rows. Reassignment away from you is invisible (no event), and the 30 s poll covers it (`removedOrders` → "gone"). |
| Accept races | `accept_order` is one conditional `update ... where driver_id is null and status = 'ready'` with role, active and flag re-checked under the driver's row lock (DRIVER-API §3.2). CI `db:concurrency` runs 8 drivers on one order, and exactly one wins. The app maps `ORDER_NOT_AVAILABLE` → "قبله سائق ثاني" (faded card, dropped on the next refresh) and `NOT_ALLOWED` → `refreshProfile` + guard. |
| Status transitions | `nextAction`: `ready` → `out_for_delivery`, `out_for_delivery` → `delivered` (with a confirmation sheet showing the amount), `preparing` → disabled button, final statuses → no button. `p_return_stock` is never sent. `INVALID_TRANSITION` → reload; `NOT_ALLOWED`/`NOT_AUTHENTICATED` → "الطلب ما بقى إلك" + guard re-check. The DB enforces all of it (pgTAP `04`, `05`). A lost response after a successful `delivered` is harmless: retrying gives `INVALID_TRANSITION`, which reloads. |
| R1 L6 (guard with unreadable profile) | Closed by T31: `isDriverAccessError` → `refreshProfile` on every driver call (`available_orders`, `accept_order`, `set_order_status`). `register_push_token` runs only when the profile says active driver. Jest covers it per screen and in `orders-api.test.ts`. |
| Today's cash on Baghdad day boundaries | `baghdadDayRange` = `floor((t + 3h) / 24h) * 24h − 3h` → `[from, from + 24h)` in UTC ISO. Fixed UTC+3 with no DST is correct for Iraq. The query is `.gte(from).lt(to)` on `delivered_at`, `status = 'delivered'`, `driver_id = me`, newest first, limit 200. `sumCash` = Σ `total_iqd` (includes the delivery fee, SPEC §2.9). The range is recomputed on every 30 s poll, so an open screen rolls over within 30 s of midnight. The 23:59 / 00:01 tests are in `packages/shared`. |
| Push payloads | Driver-facing outbox rows: `new_order` title `طلب جديد #N`, body `بلوك X - بناية Y`, `data = {order_id, type}`. That is the same information as the ready list, so the lock screen shows no name, phone, floor or apartment. `ready`/`assigned`/`unassigned`/`cancelled` go only to the assigned driver, who can already read the order. Nothing is pushed while `must_change_pin`. The registration push (`driver_request_approved`) carries only `request_id`. |
| Notification routing | `routeForNotification` is a pure function. `order_id` must match a UUID before it is used in `/order/<id>`, and unknown types are ignored. Routing waits until the guard has decided (`isGuardBlocking`), and the guard redirects any route the current state doesn't allow (for example a signed-out device tapping an old `new_order`). `clearLastNotificationResponse` prevents replays. |
| Token registration | Only for an active driver without `must_change_pin` (the server refuses a flagged account anyway: `PIN_CHANGE_REQUIRED`). Runs on start, sign-in and flag clear, and again on `addPushTokenListener`. Permission is asked once after the first sign-in. Android channel `orders` (HIGH) is created before the permission request. |
| Account sign-out (account tab) | `signOutDriver`: delete this device's `push_tokens` row → `removeAllChannels` → `signOut`. If the delete fails, it stops and shows an error instead of signing out silently. Jest checks the order. |
| Delete account | `delete-account` (POST with the user's JWT). `ACTIVE_ORDER` → driver message. Success → clear local token key, local sign-out, drop channels. The server deletes tokens and revokes the refresh token (DRIVER-API §8). |
| Offline (R1 M2 still holds) | `loadSession` signs out only on a definite rejection (`AuthApiError` 400/401 or the session-gone codes). Network errors → `auth/offline` with retry, retried on every resume. Screens show the shared network message on fetch errors and keep the last list. |
| Secrets in the bundle / EAS | `config.ts` reads only `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SHOP_PHONE`, `EXPO_PUBLIC_SHOP_WHATSAPP`. `createSupabaseClient` refuses `sb_secret_` and service_role JWTs. The local Android bundle contains `sb_publishable_…` and the dev URL only. The strings `service_role` / `sb_secret_` in it are the refusal check, not keys, and no `eyJhbGci` JWT is present. `app.config.ts` refuses `APP_ENV=production` with the dev URL. `eas.json` has no secrets. `GOOGLE_SERVICES_JSON` is an EAS file variable. |
| `.gitignore` | `apps/driver/.env` (via `.env*`), `google-services.json`, `GoogleService-Info.plist`, `*-firebase-adminsdk-*.json`, `fcm-service-account*.json` and `dist-check/` are ignored (`git check-ignore` confirms). `git ls-files apps/driver` holds only `.env.example`, `eas.json`, `package.json`, `tsconfig.json` among config files. See L4 for signing files. |
| R1 fixes on dev | `set_user_role` and `finish_driver_registration` contain the H1 / L1 checks; `decide_driver_request` handles `approved` (M1). Grants are unchanged: `driver_request_status` anon + authenticated; `finish_driver_registration` service_role only; `pending_driver_requests_count`, `decide_driver_request`, `available_orders`, `accept_order`, `register_push_token` authenticated only. |
| CI coverage for `apps/driver` | lint, typecheck and Jest (with an explicit check that `@mukhdar/driver` is in the recursive run), `export:android` (a Metro bundle, no EAS), pgTAP (`05_driver`, `36_driver_requests`, `32_real_role_writes`), `db:concurrency`, Deno for both registration functions, Playwright for `/driver-requests`. There is no native E2E: the on-device check is T33. |

## Findings

### Critical

#### C1. Opening an order from "My orders" (or after visiting it) crashes the app: shared Realtime topic

- **Where:** `apps/driver/src/features/orders/mine.ts` `subscribeMyOrders` (`c.channel(\`driver-orders-${userId}\`)`),
  called from both `app/(tabs)/my-orders.tsx` and `app/order/[id].tsx`.
- **Problem:** In `@supabase/realtime-js` 2.119.0, `RealtimeClient.channel(topic)` returns the **existing** channel
  when one with the same topic is already registered (`RealtimeClient.js` around line 338). Tabs stay mounted once
  visited, so "My orders" holds a joined channel `driver-orders-<me>`. When `order/[id]` mounts, it gets that same
  channel and calls `.on('postgres_changes', …)`. `RealtimeChannel.on` throws
  `cannot add postgres_changes callbacks for realtime:driver-orders-<id> after subscribe()` when the channel is
  joined or joining (`RealtimeChannel.js` around line 417). The throw happens inside a `useEffect`, so the order
  screen crashes. Even without the throw, the detail screen's cleanup calls `removeChannel` on the **shared**
  channel, which would silently end "My orders" Realtime for the rest of the session.
- **Impact:** The main delivery path (My orders → order → "بالطريق" / "تم التوصيل") breaks on a real device. It
  also breaks Ready → accept → order once the driver has opened "My orders" earlier. This is not a security issue.
  Jest misses it because `test-utils` and the screen tests build a fresh fake channel on every `channel()` call. It
  would have shown up first at T33.
- **Fix:** Give each subscription its own topic, for example ``driver-orders-${userId}-${++seq}``, or keep one
  module-level subscription with ref-counted listeners that both screens share. Make the Jest fake behave like
  realtime-js: dedupe by topic, and throw on `.on()` after `subscribe()`. Add a test that mounts "My orders" and then
  the order screen with the same fake client, and assert that unmounting the order screen doesn't remove the
  list's channel.
- **Needs:** app code + Jest only. No migration, redeploy or cloud change. **Must land before the T33 APK build.**

### High

None.

### Medium

#### M1. The T33 `preview` APK likely builds without `EXPO_PUBLIC_*`, `GOOGLE_SERVICES_JSON` and the EAS project id

- **Where:** `apps/driver/eas.json` (profiles `development` / `preview` / `production` set `env.APP_ENV` but no
  `environment`), T32 status ("متغيرات `EXPO_PUBLIC_*` لبيئة development"), `app.config.ts`
  (`extra.eas.projectId` only when `EAS_PROJECT_ID` is set; `googleServicesFile` only when `GOOGLE_SERVICES_JSON` is
  set), `.env.example` (`EAS_PROJECT_ID` read from the local `.env`).
- **Problem:** EAS picks variables by environment (`development` / `preview` / `production`). When a profile
  doesn't name one, an internal-distribution build doesn't use `development`. The worker also doesn't receive the
  git-ignored `apps/driver/.env`. So the `preview` build probably resolves `app.config.ts` with no Supabase URL or
  key, no `googleServicesFile` and no `extra.eas.projectId`.
- **Impact:** The APK either shows "not configured" on every screen, or has no FCM, so `getExpoPushTokenAsync`
  fails, no token is registered and nothing arrives (SPEC §9 point 4). T33 would burn a build, or pass the screens
  while silently skipping push.
- **Fix:** Add `"environment": "development"` / `"preview"` / `"production"` to the three profiles. Create the
  `preview` variables with owner approval: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (dev,
  since the internal APK targets mukhdar-dev), `EXPO_PUBLIC_SHOP_*`, `EAS_PROJECT_ID` and the `GOOGLE_SERVICES_JSON`
  file. Simpler for the project id: write it into `app.config.ts` (it's public) instead of an env var. Before the
  build, check `eas env:list --environment preview` and `eas config --profile preview --platform android`
  (read-only). Add one line to RUNBOOK §16e.
- **Needs:** `eas.json` + RUNBOOK (repo), EAS variables (cloud, **owner approval**), then the T33 build. No
  migration or redeploy.

#### M2. Sign-out from the offline, not-driver and forced-PIN screens leaves the push token on the server

- **Where:** `app/auth/offline.tsx`, `app/auth/not-driver.tsx` and `app/auth/change-pin.tsx` call
  `features/auth/store.ts` `signOut`, which doesn't call `unregisterPushToken`. Only the account tab uses
  `signOutDriver`. `signOut` also falls back to a local-only sign-out on any network error.
- **Problem:** DRIVER-API §3.4 / §6 says to delete this device's `push_tokens` row before signing out. On the offline
  screen the session is an active driver's with a registered token. Signing out there clears the session locally,
  but the token row (and the refresh token) stay on the server. On the not-driver and forced-PIN screens the server
  has usually already deleted the tokens (deactivation, downgrade, PIN reset), so the risk there is small.
  Promotion to staff/admin keeps the rows, but staff/admin pushes need an aal2 session, so they are not delivered.
- **Impact:** A shared or handed-over phone where the driver signed out offline keeps receiving that driver's
  pushes: `طلب جديد #N` with block and building, and for assigned orders the order number. This continues until
  someone signs in on it (the token moves) or the 60-day cleanup. Tapping one leads to the login screen, so there's
  no data access. A small leak plus confusion.
- **Fix:** Send every sign-out through one function. Try `unregisterPushToken`. If that can't reach the server, call
  `Notifications.unregisterForNotificationsAsync()` before the local sign-out. That invalidates the device token,
  so Expo answers `DeviceNotRegistered` and `push-dispatch` deletes the row. Keep the offline screen's sign-out (the
  owner chose it in R1 M2) and add a Jest case per screen.
- **Needs:** app code + Jest. No migration or redeploy.

### Low

#### L1. A fast double tap on "قبول الطلب" can show "قبله سائق ثاني" for your own accept

- **Where:** `(tabs)/index.tsx` `onAccept` guards with `accepting` **state**, so two taps before the re-render both
  call `accept_order`. **Problem:** the second call gets `ORDER_NOT_AVAILABLE` (the order is now yours), so the card
  is marked "taken" just as the first call navigates to the order. **Impact:** a confusing flash. The server stays
  correct. **Fix:** guard with a `useRef`, as `load` already does. **Needs:** app code.

#### L2. Account-tab sign-out uses the default `global` scope

- **Where:** `store.ts` `signOut` → `client.auth.signOut()` (supabase-js default `scope: 'global'`). **Problem:**
  signing out on one phone revokes the driver's sessions on every device, without saying so. SPEC §2.10 just says
  `signOut()`. **Impact:** surprising for a driver with two devices, and it won't matter for most. **Fix:** decide
  and write it in SPEC-driver §2.10, either `scope: 'local'` after deleting the token or keep `global` on purpose.
  **Needs:** SPEC (+ one line of code if changed).

#### L3. Today screen doesn't re-check the guard on access errors, and has no in-flight guard

- **Where:** `(tabs)/today.tsx` / `features/today/today.ts`. **Problem:** a driver who was deactivated a moment ago
  reads zero rows under RLS, so the screen shows `0` cash instead of moving to "not activated" (the next resume
  catches it). Overlapping polls can also race. **Impact:** cosmetic, and only briefly. **Fix:** an `inFlight` ref as
  in the other screens. Optionally `refreshProfile` when the result is empty. **Needs:** app code.

#### L4. `.gitignore` doesn't cover Android/EAS signing artifacts

- **Where:** root `.gitignore`. **Problem:** `credentials.json` (EAS local credentials, which hold the keystore
  password), `*.keystore`, `*.jks`, `*.p8`, `*.p12`, `*.mobileprovision`, and the prebuild output
  `apps/driver/android/` / `ios/` (which would contain a copied `google-services.json`) are not ignored. Today the
  credentials are remote on EAS, so nothing is exposed. **Impact:** an accidental commit if someone runs
  `eas credentials` with local storage or `expo prebuild`. **Fix:** add those patterns. **Needs:** repo only.

#### L5. Cold-start notification tap vs the guard redirect: verify on device

- **Where:** `NotificationsBridge` routes as soon as `isGuardBlocking` turns false, and `AuthGuard` may
  `router.replace('/')` from an auth path in the same tick. **Problem:** the push to `/order/<id>` can be replaced by
  the guard's redirect, so the driver lands on the ready list instead of the order. **Impact:** UX only.
  **Fix:** add "app killed → tap `assigned` → opens the order" to the T33 checklist. If it fails, route after the
  guard's redirect settles (for example once the pathname is not an auth path). **Needs:** T33 check, maybe app code.

#### L6. Driver Jest runs out of memory with default workers on Windows

- **Where:** `apps/driver` `jest` (no `maxWorkers` / `workerIdleMemoryLimit`). **Problem:** `pnpm --filter
  @mukhdar/driver test` failed locally with "Jest worker ran out of memory" in 12 suites, while `--runInBand` passes
  216/216. CI (Linux) is green. **Impact:** false red runs on the owner's machine. **Fix:** set
  `"workerIdleMemoryLimit": "512MB"` or `--maxWorkers=50%` in the test script. **Needs:** repo only.

## Fix status (2026-11-21, PR `fix/r2-driver-review`)

Items 1–6 are done (app code, Jest, SPEC/RUNBOOK, and the EAS `preview` variables). Owner decisions: C1 unique topic per subscription plus a realistic Realtime fake; M2 one `signOut` path with offline queue; L2 = `scope: 'local'`; M1 = `preview` variables for the dev URL and publishable key only. Item 7 (L5 and the device checks) stays with T33 and is now in its checklist. No migration, no Edge Function, nothing on prod. `EXPO_PUBLIC_SHOP_*` were **not** created in `preview` (not in the approval); T33 asks the owner.

## Ordered fix list (before T33)

| # | Item | Change | Deploy |
|---|---|---|---|
| 1 ✅ | C1 unique / shared Realtime subscription | `features/orders/mine.ts` (+ both screens), realistic channel fake, mount-both test | none (app code) |
| 2 ✅ | M2 one sign-out path, token deleted or device unregistered | `features/account/account.ts` / `store.ts`, `auth/offline`, `auth/not-driver`, `auth/change-pin` + Jest | none |
| 3 ✅ | L1, L3 in-flight refs | `(tabs)/index.tsx`, `(tabs)/today.tsx` | none |
| 4 ✅ | L4, L6 repo hygiene | `.gitignore`, `apps/driver/package.json` jest config | none |
| 5 ✅ | L2 decide the sign-out scope | SPEC-driver §2.10 (+ code if changed) | none |
| 6 ✅ | M1 EAS `preview` environment | `eas.json` `environment` per profile, project id in `app.config.ts` (optional), RUNBOOK §16e; then the EAS variables | EAS env vars (**owner approval**) |
| 7 ⬜ (T33) | L5 + the existing T32 device checks | T33 checklist | T33 APK build (owner approval) |

Items 1–5 fit in one app-only PR (no migration, no Edge Function redeploy). Item 6 needs the owner to create the EAS
`preview` variables before the first T33 build. After the fixes: `pnpm lint && pnpm typecheck && pnpm test`, the
`export:android` CI step, and `pnpm sb migration list --remote` (still 39 = 39).
