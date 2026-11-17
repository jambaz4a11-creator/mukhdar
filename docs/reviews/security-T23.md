# T23: Security review before launch

> **Status (2026-11-17, fix session E2): all 15 fix-list items are done** (see the table at the end); the decisions and accepted risks are in [ADR 0003](../ADR/0003-security-review.md). The text below is the original review and is kept as written. Findings quoting counts at the time (30 RPCs, 31 advisor warnings) are now 33 RPCs and 34 warnings (RUNBOOK §5).

- **Date:** 2026-11-17. **Scope:** the whole repo at `c2de06b` (migrations 1–29, five Edge Functions, admin panel,
  customer app, `packages/shared`, scripts, CI), the live **mukhdar-dev** project, and the docs (CLAUDE.md, tasks,
  SPEC-admin/backend/customer, DRIVER-API, RUNBOOK, ADR 0001, design README, every file in `docs/reviews/`).
- **Attackers considered:** no account; a customer; a driver (third-party app built from DRIVER-API.md); a staff
  member; someone holding a stolen phone or laptop. Also an operator mistake (dev/prod mix-up).
- **Method (read-only):**
  - mukhdar-dev, inside `begin transaction read only … rollback`: `pg_class.relrowsecurity`, `pg_policies`,
    `information_schema` table/column grants, `has_schema_privilege` / `has_function_privilege` / `has_sequence_privilege`
    for `anon` / `authenticated`, `prosecdef` + `proconfig` of all 80 functions in `public` / `private`,
    `pg_get_functiondef` of the core RPCs, constraints, foreign keys, the Realtime publication, `storage.buckets` and
    `storage.objects`, extensions, `auth.users` triggers, `auth.sessions`, role settings, cron jobs, Vault secret names.
  - `pnpm sb db advisors --remote` (read-only command).
  - Unauthenticated HTTP probes with the **publishable key only**: `GET /auth/v1/settings`, `GET` on 11 tables, 2 RPCs,
    OpenAPI root, `Accept-Profile: private`, storage list, and the 5 Edge Functions (no JWT / CORS preflight). Nothing was written.
  - `git log --all -p` over all 73 commits for keys, tokens, passwords and env files; `pnpm audit`; GitHub repo/Actions
    settings via `gh api` (read).
  - Code read by hand: Edge Functions, `place_order`, role helpers, admin `proxy.ts` / login / Supabase clients /
    print page / PIN dialogs, customer secure storage, config, notification routing, Sentry, `app.config.ts`, `eas.json`,
    `scripts/lib/{db,sb}.mjs`, load scripts, CI workflow.
- **This review changed no application code, migration, Edge Function or cloud setting.** It adds this file and updates
  the T23 status lines.

## Summary

The database core is in good shape. RLS is on for every `public` table, `anon` reads only the catalog, settings and the
address tree, every `SECURITY DEFINER` function has a fixed `search_path`, nothing in `private` is exposed, the only
`authenticated`-callable definer functions are the 30 intended RPCs, costs and stock stay admin/staff-only, and the git
history has no leaked secret. Earlier reviews (A–D) closed the account-lifecycle, push and staff-money gaps, and they still hold.

The risks that remain are mostly about **who can get in** and **what one cheap account can do**, plus two launch
blockers in the rollout itself:

1. **Admin and staff logins are a 6-digit PIN with no lockout and no second factor (C1).** With rotating IPs, an attacker
   who knows the owner's number can guess the admin PIN in hours. That gives every customer's phone and address, prices, staff
   accounts and settings. Supabase TOTP MFA is free on every plan and can be enforced inside `current_user_role()`.
2. **The deployed admin panel cannot call `admin-reset-pin` / `admin-create-user` (H1).** The hosted functions answer the
   browser's CORS preflight with `405` and no CORS headers (probed on dev). CI passes only because local Kong adds CORS.
3. **One free, unverified account can tie up the whole stock (H2):** 3 open orders × 50 lines × 99 units.
4. **RUNBOOK §17.4 tells the operator to add the production ref to the dev allow-list (H3).** `seed:demo`,
   `seed:reset` and `db:test:remote` would then accept production.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 3 |
| Medium | 7 |
| Low | 11 |

---

## Checked and OK (evidence)

| Area | Result (mukhdar-dev, live) |
|---|---|
| RLS | Every table in `public` has `relrowsecurity = true`. Tables without RLS exist only in `private` (`account_deletions`, no grants) and `realtime` (Supabase-managed partitions; no `anon`/`authenticated` grants on them). |
| `anon` | `SELECT` only on `app_settings`, `cities`, `sectors`, `subsections`, `buildings`, `categories`, `products`, `vendors` (active rows by policy). Probes: `profiles`, `orders`, `addresses`, `product_costs`, `stock`, `push_tokens`, `notification_outbox`, `admin_audit`, `ratings` → `401 42501`; `rpc/available_orders` → `401`; OpenAPI root → "Secret API key required". |
| Exposed schemas | `Accept-Profile: private` → `PGRST106 … exposed: public, graphql_public`. `pg_graphql` is not installed. `vault` and `cron`: no `USAGE` for `anon`/`authenticated`. |
| Grants | `authenticated` writes only: `addresses` (column-limited insert/update + delete, own rows), `push_tokens` delete (own), `profiles.full_name` update (own), admin-gated writes on `categories`/`cities`/`vendors`/`sectors`/`subsections`/`buildings` (column-limited update). No insert/update/delete on `orders`, `order_items`, `stock`, `inventory_movements`, `daily_stats`, `ratings`. No sequence `USAGE`/`UPDATE` for `anon`/`authenticated` (30 checks). |
| Functions | 80 functions; **all** have `proconfig` `search_path` (`''` or `public, pg_temp`). `anon` can execute only `round_iqd`, `baghdad_today` and the role helpers (return null/false for anon). `private.*` executable by `anon`/`authenticated`: only `current_user_role`, `is_admin`, `is_staff_or_admin` (needed by policies, not reachable through the API). Service-role-only functions (`signup_rate_hit`, `revoke_user_sessions`, `record_pin_reset`, `finish_user_creation`, `admin_rate_hit`, `begin/abort_account_deletion`, `claim/finish_push_notifications`, `push_dispatch_authorized`) are not executable by `authenticated`. `hook_send_sms_reject` executable by `supabase_auth_admin` only. |
| Role helper | `private.current_user_role()` = role only where `is_active and not must_change_pin`; every staff/admin policy and RPC goes through it. |
| Advisors | 30 × `authenticated_security_definer_function_executable` (exactly the intended RPC list) + `auth_leaked_password_protection` (intentionally off). No `ERROR` level. |
| Auth (dev) | `/auth/v1/settings`: `disable_signup: true`, `phone: true`, `phone_autoconfirm: true`, `anonymous_users: false`, all OAuth off, `email: true` (dev only, by design for `it:delete-account`). `auth.users`: 25 users, 0 without phone, 0 with email. |
| `place_order` | Prices read from `products` inside the function; app prices ignored. `qty` must be a JSON integer 1..99 per product after merging duplicates, ≤ 50 lines, own address only, active address tree, stock locked in `product_id` order, idempotency per customer under an advisory lock, `max_active_orders`. |
| Storage | One bucket `product-images`: public read by URL, `file_size_limit = 524288`, `allowed_mime_types = jpeg/webp/png` (no SVG/HTML). Upload/update/delete/list: admin only by policy. Anonymous list → `[]`. 60 objects, all PNG ≤ 1 KB. |
| Realtime | Publication `supabase_realtime` contains `public.orders` only; postgres_changes are filtered by the `orders_read` policy per subscriber. `realtime.messages` has no policies → private channels closed. |
| Edge Functions | No JWT → `delete-account` 401, `admin-reset-pin` 401 (publishable key as bearer also 401), `push-dispatch` without secret 401. `requireAdmin` = `auth.getUser` + active admin + not flagged. Bodies capped (1–2 KB), generic error codes, PIN never logged (`errTextWithout`). `signup` counts every attempt before validation (20/h per IP, 5/h per phone, hashed keys). Secrets: only the injected `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (+ optional `EXPO_ACCESS_TOKEN`). |
| Admin panel | No `dangerouslySetInnerHTML`; React escapes all user text (names, notes, comments). Only server action = `signOut` (Next.js checks Origin on server actions). No route handlers. `env.ts` and the shared client refuse `service_role`/`sb_secret_` keys; `noServiceRole.test.ts` scans the source. CSV text cells are prefixed against formula injection (review C, L1). PIN no longer in the login URL (review C, M1). |
| Customer app | Session in `expo-secure-store` (Keychain/Keystore, chunked). Only `EXPO_PUBLIC_SUPABASE_URL` + publishable key in the bundle; `createSupabaseClient` refuses server keys. Notification routing accepts only a UUID `order_id`. Deep links carry no tokens (no magic links/OAuth), so scheme hijacking has nothing to steal. Sentry off without DSN, `sendDefaultPii: false`. |
| Git history | 73 commits: no `sb_secret_`, `sb_publishable_`, JWTs, `sbp_`/`ghp_` tokens, private keys, DB URLs with passwords, Twilio SIDs, Google keys or Sentry DSNs. Only `.env.example` files were ever committed. Only literal PINs: `DEMO_PIN` `482915` (documented dev-only) and test values. |
| CI / GitHub | Private repo, 1 collaborator, no Actions secrets, `permissions: contents: read`, default workflow token read-only, actions pinned by SHA, CI uses a local Supabase only. |
| Scripts | `seed:demo`, `seed:reset`, `db:test:remote`, `db:concurrency`, `load:*`, `it:*` refuse any ref not in `DEV_PROJECT_REFS` and `MUKHDAR_ENV=production`; `db:concurrency` local only; break-glass requires a TTY, refuses `CI`, prints the target and requires the typed ref for non-dev. `pnpm sb` refuses unknown refs and the placeholder prod ref. |

---

## Critical

### C1. Admin and staff accounts are protected by a 6-digit PIN only (online guessing)
- **Attacker:** no account (targets the owner/admin or a staff member).
- **Where:** Supabase Auth `signInWithPassword` (phone + PIN), same for every role (ADR 0001); `private.current_user_role()`
  grants the role from the password session alone.
- **Exploit:** the admin's number is easy to find (RUNBOOK §7 makes the owner's real number the first admin; the shop
  WhatsApp number is in the app and on `/privacy`). 10⁶ PINs minus ~50 trivial ones. The only brake is the per-IP limit
  (30 sign-ins / 5 min). Through residential proxies or IPv6 rotation, 1,000 addresses give 360,000 guesses an hour, so the
  expected time to the admin PIN is about 1.5 hours. No per-account lockout exists on Free/Pro, and failures are not
  visible to Postgres. `signup` `PHONE_TAKEN` confirms which numbers are registered.
- **Impact:** full admin: every customer's name, phone and address (`profiles`, `orders`, `addresses`); prices and costs;
  create staff/driver accounts; reset other users' PINs; close the store; 400-day panel cookie (M7). A staff account gives
  every order's phone and address (see M6).
- **Fix (recommended, free on every plan):** **TOTP MFA for `admin` and `staff`, enforced by the database.**
  1. Migration: `private.current_user_role()` returns `staff`/`admin` only when `(select auth.jwt() ->> 'aal') = 'aal2'`
     (customer/driver unchanged). Every policy, RPC, `report_*`, `dashboard_today` and Realtime row check already goes through it.
  2. Edge Functions `admin-reset-pin` / `admin-create-user`: `requireAdmin` also requires `aal2` (verify the claims
     with `auth.getClaims(jwt)`, not just `getUser`).
  3. Admin panel: after the PIN, enrol (QR) on first sign-in, then challenge on every sign-in (`auth.mfa.*`); the proxy
     sends `aal1` panel users to the MFA page.
  4. Break-glass script: also unenrol the admin's factors (`auth.admin.mfa.deleteFactor`) so a lost authenticator can be recovered.
  5. Operations: the admin account must not use the number published as the shop WhatsApp.
- **Needs:** migration + Edge Function redeploy (2) + admin panel change (not yet deployed) + prod dashboard setting
  (Auth → MFA → TOTP enabled). No customer app rebuild.

---

## High

### H1. Deployed admin panel cannot call `admin-reset-pin` / `admin-create-user` (CORS)
- **Attacker:** none. This is a launch blocker found during the CORS check, with a security angle on the fix.
- **Where:** `supabase/functions/admin-reset-pin`, `admin-create-user` (and `_shared/admin.ts`): no `OPTIONS` handling,
  no `Access-Control-Allow-*` headers. The panel calls them from the browser (`features/admin/api.ts` → `functions.invoke`).
- **Evidence:** on mukhdar-dev, an `OPTIONS` preflight with `Origin: https://admin.example.com` returns
  `HTTP 405` with **no** CORS headers for `admin-reset-pin`, `admin-create-user` and `delete-account` (PostgREST returns 200
  with `ACAO: *`). The browser will block every "reset PIN" and "add staff/driver" from Vercel. CI's Playwright passes
  because the local Kong adds CORS; local runs against dev never write.
- **Impact:** forgotten PINs and new staff/driver accounts cannot be handled from the production panel. Then the only
  path left is manual SQL, which the RUNBOOK forbids for good reasons.
- **Fix:** in both admin functions, answer `OPTIONS` with `204` and, on every response, set
  `Access-Control-Allow-Origin` to an **allow-list** read from a function secret (e.g. `ADMIN_ORIGINS=https://admin.<domain>`,
  plus `http://localhost:3000` on dev only). Echo the request origin only when it is on that list; never `*`. Also set
  `Access-Control-Allow-Headers: authorization, apikey, content-type, x-client-info`, `Allow-Methods: POST, OPTIONS`,
  `Vary: Origin`. Leave `signup`/`delete-account` without CORS (native apps only). Add a Deno test and a manual browser check
  on dev (panel on localhost against mukhdar-dev: reset a demo customer).
- **Needs:** Edge Function redeploy (dev, then prod) + one secret per project. No migration.

### H2. One unverified account can lock up the whole stock (fake orders)
- **Attacker:** no account → creates one with `signup` (no proof of phone ownership, ADR 0001).
- **Where:** `place_order` limits: `qty` 1..99 per product, ≤ 50 lines, `max_active_orders` = 3 (default), `min_order_iqd` = 0.
- **Exploit:** 3 orders × 50 products × 99 units reserves up to 297 units of 150 product-slots, which covers most of the
  60-product catalog. Customers then see "out of stock" until staff cancel each order by hand. The attacker places new
  orders again at once. `signup` allows 20 new accounts per hour per IP, and new IPs are cheap. The same path allows prank
  cash-on-delivery orders to any building/apartment in another person's (unregistered) number.
- **Impact:** sales stop (stock DoS), staff time, wasted trips. No money is lost directly (cash on delivery).
- **Fix (migration, owner decides the numbers):**
  - Per-line cap far below 99 (e.g. `products.max_per_order`, default 10 half-kilos/units; admin-editable).
  - Per-order cap on total units and/or subtotal (`app_settings.max_order_iqd`).
  - New accounts: `max_active_orders` = 1 until the first order is `delivered`.
  - Optional: staff phone-confirm the first order of a new number before `preparing` (process only).
  - Panel: "cancel all open orders of this customer + deactivate" in one action (`set_user_role(..., false)` already
    revokes sessions).
- **Needs:** migration + admin panel change; customer app shows the new error codes (`errors.ts` + app rebuild).

### H3. RUNBOOK §17.4 tells the operator to put the production ref in the dev allow-list
- **Attacker:** operator mistake (the H1 risk of review C, reintroduced by a later doc line).
- **Where:** RUNBOOK §17 "قائمة فحص قبل الإطلاق", item 2: "re-run `pnpm load:run` on production … **after adding the
  production ref to the allow-list of `pnpm sb` and `scripts/load`**". `scripts/load` checks `DEV_PROJECT_REFS`
  (`scripts/lib/db.mjs`). That same list is the only guard of `seed:demo`, `seed:reset`, `db:test:remote`, `it:*` and
  the "dev" banner of `pnpm sb`.
- **Exploit/impact:** following the checklist makes production look like dev to every guard: `seed:demo` (accounts with
  the **public** `DEMO_PIN`, including a demo **admin** `9647000000001`), `seed:reset` (deletes data by phone prefix),
  `pnpm sb` without the typed-ref confirmation. It also contradicts SPEC-backend §9 ("staging with production compute,
  **not** production").
- **Fix:** rewrite §17.4. Run the latency/load test on a temporary **staging** project in the production region and
  compute size, created and deleted for the test (cost: hours of compute). If the owner insists on production before
  opening, use a separate `LOAD_TARGET_REFS` list read **only** by `scripts/load`. That run must use random per-run PINs
  and never `DEMO_PIN`, must run before real customers, and must end with `load:cleanup` + a zero-leftover check.
  `DEV_PROJECT_REFS` must never contain the prod ref (add a unit test: `DEV_PROJECT_REFS ∩ PROD_PROJECT_REFS = ∅`).
- **Needs:** docs (RUNBOOK §17, SPEC-backend §9 if staging is confirmed) + a small script/test change. No migration.

---

## Medium

### M1. Customer PIN guessing, number enumeration and mass sign-up (decision on CAPTCHA/lockout)
- **Attacker:** no account.
- **Where:** GoTrue per-IP limits only; `signup` (`PHONE_TAKEN`, 20/h per IP).
- **Exploit:** (a) one phone, many PINs: same arithmetic as C1, but the prize is one customer's addresses and order
  history (and ordering in their name). (b) One PIN across many phones (spraying): find registered numbers through
  `PHONE_TAKEN` (5/h per number, 20/h per IP), then try a few popular-but-allowed PINs (birth years like `199001`) on each.
  (c) Accounts in bulk for H2.
- **Impact:** privacy of individual customers; feeds H2.
- **Fix / decision (recommended):**
  - **Phase 1 (launch):** keep 30/5 min per IP (CGNAT, ADR 0001); C1 removes the high-value targets. Add monitoring:
    weekly check of Auth logs for repeated `invalid_credentials` per phone and bursts of 429 (RUNBOOK §6 already says
    "watch"); add a saved Logs Explorer query and an owner alert.
  - **Trigger for phase 2:** any spraying pattern, or more than N failed sign-ins per phone per day. Then enable
    **Cloudflare Turnstile** (free) in Supabase Auth for sign-in and sign-up. This needs a WebView widget in the customer app, the
    driver app (tell the third-party developer early), and the panel, plus a `captchaToken` on `signup`
    (`auth.admin.createUser` does not check it, so verify Turnstile inside `signup` with a function secret).
  - Per-account lockout is still not available on Pro (Password Verification Hook = Teams). Option (c) of ADR 0001
    (sign-in via Edge Function + pepper) stays deferred.
  - Enumeration through `PHONE_TAKEN`: accepted (ADR 0001); the per-number and per-IP limits stay.
- **Needs:** prod dashboard (log query/alert) now; app rebuilds + Edge Function redeploy only if phase 2 is triggered.

### M2. "Forgot PIN" over WhatsApp: verification rules are thin (social engineering)
- **Attacker:** anyone who can message the shop from, or claim, the victim's number. WhatsApp account hijacking via OTP
  social engineering is common.
- **Where:** RUNBOOK §16 ("the person messages from the same registered number → search → reset"), ADR 0001 §5,
  `/delete-account` page (same channel for deletion), `PinDialogs` (`wa.me` link with the PIN in the URL).
- **Exploit:** a message "I lost my SIM, this is my new number", a forwarded message or a screenshot, or a hijacked
  WhatsApp gets a reset. For a **driver or staff** account this gives orders with customer phones/addresses (staff: all
  orders, M6). The temp PIN goes through `wa.me`, so it stays in the admin browser's history and in WhatsApp chat
  backups (mitigated: `must_change_pin`).
- **Impact:** account takeover of the targeted user. The real owner is signed out everywhere and only notices later.
- **Fix (docs + panel text):** add to RUNBOOK §16 and to the reset dialog:
  1. Reset only when the WhatsApp chat header number (not the display name, not a forwarded message, not a screenshot)
     equals `profiles.phone`; never for "new number" claims (new number = new account, or admin changes the number after an in-person check).
  2. Call the registered number back by **voice** before resetting; for **staff/driver** accounts, reset only in person
     or after a voice call with someone the admin knows.
  3. Ask one account fact (name on the account, last order's unit/building).
  4. After the reset, tell the person that all devices were signed out; if they didn't ask for it, deactivate the account.
  5. Prefer "Copy" + paste into the same chat over the `wa.me` link (keeps the PIN out of browser history); keep the link for convenience.
- **Needs:** docs + small panel text change. No migration.

### M3. Admin panel sends no security headers (clickjacking, no CSP)
- **Attacker:** any website the admin visits.
- **Where:** `apps/admin/next.config.ts` (only `poweredByHeader: false`); no `headers()`, no CSP.
- **Exploit:** the panel can be framed: a hidden iframe over a decoy page can trick a signed-in admin into clicking
  "reset PIN" (the PIN is shown in the frame, not to the attacker), "deactivate", "close the store", or "dismiss
  notifications". No CSP means any future XSS gets the session cookie (see M7: Supabase SSR cookies are readable by JS by design).
- **Impact:** unwanted admin actions; weaker defence in depth.
- **Fix:** `headers()` in `next.config.ts` for all routes: `Content-Security-Policy` with `frame-ancestors 'none'`,
  `default-src 'self'`, `connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co`, `img-src 'self' blob: data:
  https://<ref>.supabase.co`, `script-src 'self'` (+ nonce if Next needs inline), `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`; plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
  (keeps `/orders?order=<uuid>` out of `wa.me`/`tel` referrers), `Permissions-Policy` (camera/mic/geolocation off).
  HSTS: Vercel sends it on its domains; for the custom domain enable it in Vercel. Playwright check that the headers exist.
- **Needs:** admin panel only (ships with the first Vercel deploy).

### M4. Open redirect after login (`/login?next=/%09/evil.com`)
- **Attacker:** phisher targeting an admin or staff member.
- **Where:** `apps/admin/src/lib/access.ts` `safeNext` → `LoginForm` `router.replace(next)`.
- **Exploit:** `safeNext` blocks `//` and `/\` but not `/<TAB>/` or `/<LF>/`. Next decodes `?next=/%09/evil.com` to
  `"/\t/evil.com"`, which passes. The WHATWG URL parser removes tab/newline, so `new URL('/\t/evil.com', origin)` is
  `https://evil.com/` (checked with Node). Next's router does a hard navigation to external URLs. After a real login, the
  victim lands on a look-alike "session expired, enter PIN again" page.
- **Impact:** credential phishing of panel users (worse without C1).
- **Fix:** resolve and compare origins instead of prefix checks:
  `const u = new URL(next, 'https://x.invalid'); return u.origin === 'https://x.invalid' && !u.pathname.startsWith('/login') ? u.pathname + u.search : '/'`;
  also reject any control character (`/[\u0000-\u001f\u007f]/`). Add the tab/newline/backslash cases to `access.test.ts`.
- **Needs:** admin panel only.

### M5. Account deletion keeps name, phone and apartment in orders, but the public pages say it is removed
- **Attacker:** n/a (privacy and store-compliance risk).
- **Where:** `orders.customer_id … on delete set null` keeps `customer_name`, `customer_phone`, `address_snapshot`
  (with `apartment` and `note`), and `order_status_history`; `ratings.customer_id` set null. `/delete-account` says the
  phone number is deleted and orders stay "without link to your account"; `/privacy` says the same.
- **Impact:** the statement to users (and to Google Play's Data safety / Apple) is inaccurate: the order rows still
  identify the person (phone + apartment). Staff can still read them (M6).
- **Fix (pick one, owner decision):** (a) **recommended:** migration with an `after delete` trigger on `profiles` (or in
  the `delete-account` flow via a service-role function) that, for that customer's **final** orders, sets
  `customer_name = null`, `customer_phone = null`, and strips `apartment`/`note` from `address_snapshot` (keep sector/unit/
  building for statistics). Accounting totals do not change. (b) Keep the data for a stated period (e.g. 12 months for
  disputes), add a monthly purge job, and change the two pages to say exactly that.
- **Needs:** migration (a) or panel text change (b); no Edge Function change (the cascade runs inside `deleteUser`).

### M6. Staff can read every order ever placed (bulk export of the customer base)
- **Attacker:** a staff member (insider), or anyone with a staff account (C1, M2).
- **Where:** policy `orders_read`: `… or private.is_staff_or_admin()`, with no time or status limit; PostgREST `max_rows` 1000 per request, pageable.
- **Exploit:** `GET /rest/v1/orders?select=customer_name,customer_phone,address_snapshot&offset=…` dumps every
  customer's name, phone and flat in a few requests.
- **Impact:** the whole customer list leaves with one departing employee.
- **Fix (migration):** limit staff to what the job needs: `status in ('pending','preparing','ready','out_for_delivery')`
  **or** `created_at > now() - interval '7 days'` (admin unchanged). Check the panel's staff screens (orders tabs,
  search, ratings links) against the window; older lookups go through admin. Same idea for drivers (DRIVER-API §4 history:
  e.g. 30 days), but that is a contract change and needs the driver developer's agreement first.
- **Needs:** migration + admin panel check; DRIVER-API note if drivers are included.

### M7. Panel sessions never expire (stolen or shared laptop)
- **Attacker:** someone with the admin's or a staff member's laptop/browser profile (the shop PC).
- **Where:** `@supabase/ssr` cookies (default `maxAge` 400 days, `httpOnly: false`, no explicit `secure`); refresh tokens
  never expire (dev: 142 sessions, `not_after` null on all, oldest 2.6 days with rotation); no idle timeout in the panel;
  sign-out is `scope: 'local'`.
- **Impact:** permanent access to the panel from any machine that once signed in, until someone deactivates the account.
- **Fix:** (1) C1 (MFA). (2) Panel idle sign-out: after 12 h of inactivity, or on a shift basis, call `signOut({scope:'local'})`
  client-side. (3) Explicit `cookieOptions: { secure: true, sameSite: 'lax' }` in both `createBrowserClient` and
  `createServerClient`. (4) Supabase Pro "Time-box user sessions"/"inactivity timeout" are project-wide, so they would also
  sign out customers and drivers. Not recommended unless set long (e.g. 30 days inactivity), which is acceptable for
  customers too: owner decision.
- **Needs:** admin panel; optional prod dashboard setting.

---

## Low

### L1 (revisit of accepted risk "≤ 1 h access after revoke")
- **Status:** still accepted. Since session C, role-gated data is cut at once (`current_user_role()` reads `is_active` /
  `must_change_pin` live); only the user's **own** rows (addresses, own orders, `rate_order`, `set_default_address`,
  `push_tokens` select/delete) stay reachable with the old access token until it expires. Realtime keeps an open socket
  until the token expires.
- **Recommendation:** keep JWT expiry at **3600 s** on prod. Do not shorten it: a 15-minute expiry multiplies refreshes,
  and the per-IP `token_refresh` limit (150/5 min) is shared by many customers behind one CGNAT IP. `session_alive()` in
  the own-row policies is not worth a per-row lookup for this residual risk.

### L2. Push tokens: unbounded per user, and a known token can be moved to another account
- **Where:** `register_push_token` (any number of rows per user; `on conflict (token)` moves the row to the caller).
- **Exploit:** a customer registers thousands of syntactically valid tokens (table bloat, larger `claim_push_notifications`
  results). Someone who knows another device's Expo token can move it to their account, so the victim stops getting their own
  pushes until the next app start re-registers.
- **Fix (migration):** cap 5 tokens per user (delete the oldest by `last_seen_at`); keep the move-on-conflict (needed for
  shared devices). Optional: delete tokens not seen for 60 days in `purge_push_history`.

### L3. User text is not cleaned of bidi/control characters; addresses are unbounded per customer
- **Where:** `profiles.full_name` (≤ 80), `orders.note` (≤ 300), `addresses.note`/`label`/`apartment`; rating comments are
  already cleaned (review D). `addresses`: no per-customer row limit.
- **Impact:** RLO/zero-width characters can disguise a name or note in the panel, receipt and driver app (no script
  execution: React/`Text` escape). Address rows can be inserted without limit (storage only).
- **Fix (migration):** reuse the `rate_order` cleaning (strip bidi, zero-width, C0/C1 except LF) in `place_order` for
  the note, a trigger on `profiles.full_name`, and a trigger on `addresses` text; cap addresses at 20 per customer.

### L4. Realtime public channels are open to anyone with the publishable key
- **Where:** Realtime Broadcast/Presence on non-private channels (no `realtime.messages` policies needed for public ones).
- **Impact:** no data leak (postgres_changes on `orders` still follow RLS; the panel listens to postgres_changes only),
  but the project can be used as a free message relay that counts against Realtime quotas.
- **Fix:** prod dashboard → Realtime settings: if the "allow public access" switch exists, turn it off after checking
  that the panel's and apps' `postgres_changes` channels still connect (test on dev first). Otherwise monitor Realtime
  usage. **Needs:** prod setting only, after a dev test.

### L5. `pnpm sb` guard gaps: `--db-url` and `--dry-run`
- **Where:** `scripts/lib/sb.mjs`: `explicitRefs` checks `--project-ref`/`--remote` only, so
  `pnpm sb db push --db-url postgresql://…prod…` prints the **DEV** banner and runs. `isReadOnly` treats `--dry-run`
  anywhere as read-only, for any subcommand.
- **Fix:** refuse `--db-url` (and `--linked` mixed with another ref) unless its host contains the classified ref; accept
  `--dry-run` only for subcommands that support it (`db push`, `migration …`). Add tests.

### L6. The dev demo admin shares the PIN given to the external driver developer
- **Where:** DRIVER-API §2 ("the shared dev-only PIN we send you") = `DEMO_PIN`, which is also the PIN of the dev demo
  **admin** `07000000001` and staff `07000000002`.
- **Impact:** the third party can sign in to mukhdar-dev as admin (demo data only; can reset demo PINs, change settings,
  break T22 baselines).
- **Fix:** give the driver developer only driver demo accounts with a separate PIN (e.g. `seed:demo` sets drivers to a
  second dev PIN, or reset those three accounts to a PIN shared only with them). Never give them a dev admin.

### L7. Production `service_role` key on the owner's laptop (`.env.local`)
- **Where:** RUNBOOK §7/§17.3 (break-glass). The same `.env.local` feeds the dev scripts (`SUPABASE_SERVICE_ROLE_KEY`).
- **Impact:** a prod key that bypasses RLS sits in a plain file on a Windows dev machine. Mixing keys between projects is
  caught (the script fails), but a leaked file means full data access.
- **Fix:** do not store the prod key in `.env.local`. Keep it in a password manager and pass it as an environment
  variable only for the break-glass run. On prod use the new **secret API keys** (`sb_secret_…`, revocable one by one):
  create one named `break-glass`, rotate it after each use, and disable the legacy `service_role` JWT once the Edge
  Functions use the new keys. Laptop: BitLocker on.

### L8. Customer app build hygiene
- **Where:** `app.config.ts`, `config.ts`, `lib/sentry.ts`.
- **Findings:** (a) nothing stops a `production` EAS build from pointing at mukhdar-dev (`EXPO_PUBLIC_SUPABASE_URL` comes
  from the EAS environment); (b) Android `allowBackup` is the Expo default (true); (c) if a Sentry DSN is set, fetch breadcrumbs carry
  REST URLs (user ids in filters).
- **Fix:** (a) at start-up, if `extra.appEnv === 'production'` and the URL contains the dev ref, show a blocking error
  (plus a CI/EAS check); (b) `android.allowBackup: false`; (c) `beforeBreadcrumb` that drops query strings of
  `supabase.co` URLs. **Needs:** app rebuild (before the first store build, T24).

### L9. Self-service PIN change needs only an access token at the API level
- **Where:** GoTrue `updateUser({password})`; "secure password change" asks for reauthentication only after 24 h, and
  reauthentication is SMS (refused). The apps check the current PIN with `signInWithPassword` first, but the API does not.
- **Impact:** someone with an unlocked phone and a way to call the API with the stored session can set a new PIN and,
  with `signOut('others')`, lock the owner out. The owner recovers through WhatsApp → admin reset (M2).
- **Fix:** none needed at launch. If GoTrue's "require current password" option applies to phone users on prod, enable it
  and test on dev first.

### L10. Dependencies and GitHub settings
- `pnpm audit`: 2 **moderate**, both dev/build-time only (`glob` via jest/istanbul, `minimatch` via `@expo/fingerprint` /
  Sentry bundler plugin). Not in the app or panel runtime. Fix: bump when the upstreams do; re-run before T24.
- GitHub: Dependabot alerts **off** (`vulnerability-alerts` 404). Branch protection is unavailable on a private Free repo.
  Fix: enable Dependabot alerts + security updates; make sure the owner's GitHub account has 2FA.
- Edge Functions pin `npm:@supabase/supabase-js@2.119.0` with `deno.lock` (good); keep it updated.

### L11. Docs drift
- RUNBOOK §5 says "11 advisor warnings". The live count is **31**: 30 intended RPCs + leaked-password protection. Update
  the list so a new warning stands out.
- T23 task acceptance asks for `docs/ADR/0003-security-review.md` and three permanent pgTAP checks. `01_schema.sql` and
  `27_access_matrix.sql` already cover RLS-on-every-table, `search_path` and the executable-function list. Write ADR 0003
  when the decisions below are taken (MFA, CAPTCHA phase, retention).

---

## Prod settings checklist (merged into RUNBOOK §17.5 on 2026-11-17, fix session E2; this copy is the original wording)

**Supabase project (`mukhdar-prod`, eu-central-1 or the measured-closest region, Pro)**
- [ ] Organization: every member has 2FA; enable "Require MFA" for the org; the fewest owners (owner + one backup person).
- [ ] Spend cap / usage alerts on; email for the owner.
- [ ] **Auth → Providers:** Phone **on**, phone confirmations **off**; Email **off**; anonymous sign-ins **off**; all
      OAuth off; manual linking off; **no Test OTPs**.
- [ ] **Auth → Hooks:** Send SMS hook = Postgres `private.hook_send_sms_reject`.
- [ ] **Auth → Allow new users to sign up: OFF** (after `signup` is deployed and checked, RUNBOOK §14).
- [ ] **Auth → Passwords:** minimum length 6, no required characters, leaked-password protection **off**.
- [ ] **Auth → MFA:** TOTP **enabled** (C1). Phone MFA off (paid, SMS).
- [ ] **Auth → Rate limits:** sign-ups + sign-ins 30 / 5 min per IP; token refresh 150 / 5 min; token verifications 30.
      Write down the values on the day (they become the baseline for M1 monitoring).
- [ ] **Auth → Sessions/JWT:** JWT expiry 3600 s; refresh-token rotation on, reuse interval 10 s; time-box/inactivity:
      owner decision (M7; off or ≥ 30 days inactivity).
- [ ] **Auth → URL configuration:** Site URL = panel domain; redirect allow-list = panel domain only.
- [ ] **CAPTCHA:** off at launch; switch to Turnstile only on the M1 trigger.
- [ ] **API keys:** use the new publishable/secret keys; create a named secret key for break-glass (L7); after the
      functions and apps use the new keys, disable the legacy `anon`/`service_role` JWT keys; asymmetric JWT signing keys on.
- [ ] **Data API:** exposed schemas `public` (and `graphql_public` only if needed; `pg_graphql` not installed); max rows 1000.
- [ ] **Database:** SSL enforcement **on**; strong DB password in a password manager only; network restrictions to known IPs
      if the owner's IP is stable (else leave open, the password is the guard); `pg_graphql` not enabled.
- [ ] **Realtime:** only `public.orders` in `supabase_realtime`; public-channel access off if available and tested (L4).
- [ ] **Storage:** bucket `product-images` public, 512 KB, `image/jpeg,image/webp,image/png` (same as dev; created by
      migration `20261110000002`, verify in the dashboard).
- [ ] **Edge Functions:** `verify_jwt` = false for `push-dispatch` and `signup`, true for the other three; secrets:
      `ADMIN_ORIGINS` (H1), optional `EXPO_ACCESS_TOKEN`; nothing else. `push_dispatch_url` in Vault (RUNBOOK §11).
- [ ] **Advisors:** run `pnpm sb db advisors --remote` → exactly the 31 known warnings, 0 errors.
- [ ] **Backups:** Pro daily backups (7 days) confirmed; **PITR**: owner decision (paid add-on); one restore drill to a
      scratch project before launch (SPEC-backend §11).
- [ ] **Logs/monitoring:** saved query for repeated `invalid_credentials` per phone and 429 bursts (M1); weekly look at
      `signup_rate_limits`, `pin_resets`, `admin_audit`.

**Vercel (admin panel)**
- [ ] Team members with 2FA; production env vars only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
      (prod); Preview → dev project only.
- [ ] Deployment Protection on Preview deployments.
- [ ] Custom domain with HTTPS + HSTS; security headers from M3 visible on the live site.
- [ ] `legal.ts` filled, `IS_DRAFT = false`; `/privacy` and `/delete-account` match the M5 decision.

**Apps and accounts**
- [ ] EAS production environment: prod URL + prod publishable key; build refuses the dev ref (L8).
- [ ] Expo, Apple and Google accounts with 2FA; Apple reviewer account = `customer` role only, its own PIN (not `DEMO_PIN`).
- [ ] Driver app: before linking it to prod, check its build for keys (only the publishable key), session in secure
      storage, the CORS-free native calls, and the MFA-free driver path; hand the developer prod access only after that.
- [ ] Admin and staff accounts on prod enrolled in TOTP; the admin number is not the published shop number.
- [ ] No `seed:demo`, no `DEMO_PIN`, no load accounts on prod; `DEV_PROJECT_REFS` does not contain the prod ref (H3).
- [ ] GitHub: Dependabot alerts on; owner 2FA.

---

## Ordered fix list

| # | Item | Severity | Where | Migration | Edge Function redeploy | App rebuild / panel | Prod dashboard | Status (2026-11-17) |
|---|---|---|---|---|---|---|---|---|
| 1 | **C1** TOTP MFA for admin/staff, enforced in `current_user_role()` and `requireAdmin`; break-glass unenrols factors | Critical | `private.current_user_role`, `_shared/admin.ts`, panel login/proxy, `admin-break-glass.mjs` | Yes | Yes (`admin-reset-pin`, `admin-create-user`) | Panel | Auth → MFA TOTP on | ✅ **Fixed, fix session E1.** Migration `20261130000001` (aal2 gate in `current_user_role()`, `admin_reset_mfa`, `break_glass_reset_mfa`, `mfa_reset` audit, unconfirmed `<phone>@phone.mukhdar.invalid` label because GoTrue cannot enrol TOTP for an account without an email). `requireAdmin` → `MFA_REQUIRED`. Panel `/mfa` (enrol with QR + manual key, then code on every login), TOTP step in change-PIN, staff 2FA reset on `/staff`. Break-glass `--mfa-only` / `--with-mfa`. Applied + both functions redeployed on mukhdar-dev; TOTP was already on there (Supabase default). Prod: RUNBOOK §6 step 8, §17. |
| 2 | **H1** CORS allow-list + `OPTIONS` in the two admin functions | High | `_shared/admin.ts`, both `index.ts` | No | Yes | No | Function secret `ADMIN_ORIGINS` | ✅ **Fixed, fix session E1.** `_shared/cors.ts`: origins from secret `ALLOWED_ORIGINS` (not `ADMIN_ORIGINS`), `OPTIONS` → 204 / 403, never `*`. `cors_test.ts` calls what `index.ts` serves (no Kong), so the hosted 405 cannot hide again. Dev secret set and verified by probe. Prod: RUNBOOK §17.4. |
| 3 | **H3** rewrite RUNBOOK §17.4 (staging load test or separate `LOAD_TARGET_REFS`); test that dev/prod lists are disjoint | High | RUNBOOK, `scripts/load/lib.mjs`, `scripts/lib/*.test.mjs` | No | No | No | No | ✅ **Fixed, fix session E1.** One list file `scripts/lib/projects.mjs` (overlap = refuse everything); `assertSafeTarget` refuses a prod ref even if listed as dev, and a pooler URL of another project; `seed-guard.test.mjs` runs `seed:demo` / `seed:reset` as processes against a faked prod link. Load test: explicit `--target=prod` + TTY + typed ref. RUNBOOK §17.4 rewritten (staging preferred, never add prod to the dev list). |
| 4 | **H2** per-product and per-order caps, 1 open order for new accounts, panel "cancel all + deactivate" | High | `place_order`, `app_settings`/`products`, panel, `errors.ts` | Yes | No | Customer app (error texts) + panel | No | ✅ **Fixed, fix session E2 (2026-11-17).** Migration `20261201000001`: `app_settings.new_account_max_active_orders` (default 1; a new account has one open order until its first delivery, then `max_active_orders`), `place_order` re-checks the active profile after the lock and cleans the note, `admin_cancel_customer_orders` (admin only, confirmation dialog on the order and on the customers list, audited `customer_lockdown`, stock returned except `out_for_delivery` which is wasted), settings form field, Arabic text in the customer app. pgTAP `30_security_e2.sql`. |
| 5 | **M5** anonymize deleted customers' final orders (or change the pages + purge job) | Medium | trigger/function, `/privacy`, `/delete-account` | Yes (option a) | No | Panel text | No | ✅ **Fixed, fix session E2 (2026-11-17).** `BEFORE DELETE` trigger on `profiles` anonymizes the customer's orders (name, phone, note null; address keeps sector + unit only) and a backfill for earlier deletions. `/privacy`, `/delete-account` and the customer app text say exactly that. `12_delete_account.sql`, `it:delete-account` on dev. |
| 6 | **M3 + M4 + M7** security headers/CSP, `safeNext` by origin, cookie `secure`, idle sign-out | Medium | `next.config.ts`, `access.ts`, Supabase clients | No | No | Panel | Vercel HSTS/domain | ✅ **Fixed, fix session E2 (2026-11-17).** `next.config.ts` + `proxy.ts` (nonce CSP, `frame-ancestors`, `X-Frame-Options`, HSTS, `Referrer-Policy: same-origin`, `Permissions-Policy`, `nosniff`), `safeNext` by origin, `Secure` 7-day cookies, 12 h idle enforced in the database (`panel_sessions`, `touch_panel_session`, `current_user_role()`, both Edge Functions fail closed) + `IdleGuard` + `/login?reason=idle`. Tests: `security.test.ts`, `access.test.ts`, `30_security_e2.sql`, Deno, Playwright `security.spec.ts`. The Playwright run found a real bug: `Referrer-Policy: no-referrer` made Next reject sign-out (Origin `null`); changed to `same-origin`. |
| 7 | **M6** staff order window (open or ≤ 7 days); drivers only with the developer's agreement | Medium | `orders_read` policy, panel staff screens | Yes | No | Panel check | No | ✅ **Fixed, fix session E2 (2026-11-17).** `orders_read` policy: staff = open orders + created in the last 7 Baghdad days; admin everything; note in the staff orders screen and a clear "not found" for older links. Boundary tests in `30_security_e2.sql`. Drivers untouched. |
| 8 | **M2** forgot-PIN verification rules (RUNBOOK §16 + reset dialog text) | Medium | RUNBOOK, `PinDialogs.tsx` | No | No | Panel text | No | ✅ **Fixed, fix session E2 (2026-11-17).** RUNBOOK §7 step 4 + §16 (registered number, two questions about the last order, never an admin, staff/driver by phone call), reset dialog shows the rules and prefers copy over the WhatsApp link. |
| 9 | **M1** Auth log query + alert now; Turnstile plan written in ADR 0003 | Medium | RUNBOOK §6, ADR 0003 | No | Only if triggered | Only if triggered | Logs/alert | ✅ **Fixed, fix session E2 (2026-11-17).** No CAPTCHA at launch (owner decision); RUNBOOK §6: saved Auth-log queries, daily then weekly checks, written trigger, Turnstile steps; ADR 0003. |
| 10 | **L2 + L3** token cap, text cleaning, address cap (one migration with 4/5/7 if possible) | Low | `register_push_token`, `place_order`, triggers | Yes | No | No | No | ✅ **Fixed, fix session E2 (2026-11-17).** Same migration: `register_push_token` cap 5, `purge_push_history` removes tokens unseen for 60 days, `private.clean_user_text` triggers (profile name, address text, order note), 20 addresses per account (`ADDRESS_LIMIT`). |
| 11 | **L5** `pnpm sb` `--db-url` / `--dry-run` | Low | `scripts/lib/sb.mjs` + tests | No | No | No | No | ✅ **Fixed, fix session E2 (2026-11-17).** `--db-url` must match the classified project (pooler user or `db.<ref>` host); `--dry-run` is read-only only for `db push` / `migration`. `sb.test.mjs`. |
| 12 | **L6** separate dev PIN for the driver developer | Low | `seed:demo` / dev accounts, DRIVER-API §2 | No | No | No | No | ✅ **Fixed, fix session E2 (2026-11-17).** Demo drivers `07000000011..13` use their own dev PIN (`DRIVER_DEMO_PIN`); `DEMO_PIN` is never given to the driver developer. DRIVER-API §2, RUNBOOK §6. |
| 13 | **L7** prod secret key handling (no `.env.local`, named `sb_secret`, rotate) | Low | RUNBOOK §7/§17.3 | No | No | No | API keys | ✅ **Fixed, fix session E2 (2026-11-17).** RUNBOOK §17.5 and §7: no prod key in `.env.local`, runtime variable, `sb_secret` named `break-glass`, rotate after use. (Manual, nothing changed in the cloud.) |
| 14 | **L8** production build guard, `allowBackup: false`, Sentry breadcrumb scrubbing | Low | customer app | No | No | Customer app | No | ✅ **Fixed, fix session E2 (2026-11-17).** `app.config.ts` fails a production build that points at the dev ref, the app shows a blocking error, `allowBackup: false`, Sentry `beforeBreadcrumb` scrubs query strings. Needs the app rebuild before T24. |
| 15 | **L4, L9, L10, L11** Realtime public channels, require-current-password check, Dependabot, docs drift + ADR 0003 | Low | dashboard, GitHub, RUNBOOK §5 | No | No | No | Realtime / Auth | ✅ **Fixed, fix session E2 (2026-11-17).** L11 advisor count (34) and the merged prod settings checklist in RUNBOOK §5/§17.5; L4, L9, L10 are documented **manual** steps (Realtime test on dev first, current-password option, Dependabot + owner 2FA, not enabled in this session); ADR 0003 written. |

Items 1–4 must be done before T24. **Fix session E1 (2026-11-17):** 1–3 done, 4 partly. **Fix session E2 (2026-11-17): 4–15 done** (migration `20261201000001`, both admin functions redeployed on mukhdar-dev, `seed:reset` + `seed:demo`, `it:*` scripts green). What stays manual is listed in RUNBOOK §17.5 and ADR 0003.
