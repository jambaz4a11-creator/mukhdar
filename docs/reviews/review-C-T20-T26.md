# Review: fix session C, T20 (Reports), T25 (Home), T26 (Ratings)

- **Date:** 2026-11-17. **Scope:** commits `ef8b2fc` (fix session C), `0940428` + `e9cfc57` + `597fd7b` (T20),
  `999191c` (T25), `0ef7fcb` (T26): migrations `20261125000001_review_session_c.sql`,
  `20261125000002_address_audit.sql`, `20261126000001_reports.sql`, `20261127000001_dashboard.sql`,
  `20261128000001_ratings.sql`; `apps/admin/src/features/{reports,dashboard,ratings,orders}`, `PanelProviders`,
  the login page, pgTAP `21`, `23`–`26`, Playwright `access`/`reports`/`dashboard`/`ratings`, `scripts/report-perf.mjs`,
  RUNBOOK §8/§15/§17, SPEC-admin, SPEC-backend, DRIVER-API, `docs/design/README.md`.
- **Method:** read-only. On mukhdar-dev, inside `begin transaction read only`: live function definitions
  (`pg_get_functiondef`), `prosecdef`/`proconfig`, `has_function_privilege` for `anon`/`authenticated`, RLS policies, table
  and column grants, constraints, indexes, triggers, the Realtime publication, and a **full recomputation of `daily_stats`**
  from `orders` / `order_item_costs` / `inventory_movements` compared row by row with the stored table. Read-only Supabase CLI
  calls (`projects list`, `branches list`). CI history via `gh run list/view` (40 runs). Code read by hand.
- **This review changed no application code, migration, Edge Function or cloud setting.** The only file added is this one.

## Summary

The money and access core of T20/T25/T26 is sound. Every report number, every Home figure and the Ratings header come
from one place in the database, and they agree:

- On mukhdar-dev (500 orders, 433 delivered, 1751 movements, 244 ratings) the stored `daily_stats` equals a from-scratch
  rebuild on **every** day (0 differing rows). So `report_summary`, `report_daily` and Home's net profit / waste (all read
  `daily_stats`) agree with the direct queries behind Home's sales and counts and with `report_top_products` /
  `report_drivers` / `report_waste`.
- **No double counting** of cancel-without-return: it writes `cancel_return +N` (positive, no loss) and `waste −N` valued at
  `order_item_costs.cost_snapshot_iqd`. Only the `movements_losses` trigger adds it to `daily_stats.waste_cost_iqd`;
  `set_order_status` bumps only `cancelled_count`. Revenue/cost never enter because the order was not delivered.
- **Waste vs shortage do not overlap:** waste = `type = 'waste'`, shortage = `type = 'adjust' and qty < 0`, in `daily_stats`,
  `rebuild_daily_stats` and `report_waste` alike; `report_waste.total_cost_iqd` summed over a range = `waste_cost_iqd +
  adjust_loss_iqd` of `report_summary` (same Baghdad day boundaries).
- **Delivered on a different day than placed:** sales, cost, top products and drivers all use `delivered_at`'s Baghdad day;
  `delivered_at = now()` and `_bump_daily_stats(baghdad_today(), …)` use the same transaction timestamp, so a delivery at
  23:59:59 lands on the same day in both places. "Placed" uses `created_at` (separate count, by design).
- **Cost at order time** everywhere for sales (`order_item_costs`); losses use the unit cost frozen on the movement
  (order-time cost for cancel-without-return). Matches CLAUDE.md and SPEC-backend §2.
- **"Yesterday up to the same minute"** is implemented as specified (SPEC-backend assumption 60): today = `[00:00, end of
  current minute)`, yesterday = same offset; net profit compares with all of yesterday; `null` (shown "—") when yesterday has
  no row.
- **Staff money:** `dashboard_today()` nulls the 7 money keys and `stuck_notifications` inside the function; every
  `report_*` refuses staff; `ratings_summary` / `ratings_list` return no money.
- **Access:** every new `public` function is `SECURITY DEFINER` with `search_path = ''`, not executable by `anon`, and
  gated by `private.current_user_role()` (which already excludes deactivated and `must_change_pin` accounts). No `private.*`
  function is executable by `anon`/`authenticated` except the three role helpers used by policies; `private` is not exposed
  by PostgREST (`api.schemas = public, graphql_public`).
- **Session C still holds** after T20–T26 (live definitions): `claim_push_notifications`, `register_push_token`,
  `record_pin_reset` (deletes `push_tokens`), `set_user_role` (deletes `push_tokens` on deactivate/downgrade),
  `accept_order` (lock `role = 'driver' and is_active and not must_change_pin`), `assign_driver` (`DRIVER_PIN_PENDING`,
  same-driver no-op), `list_drivers.must_change_pin`. `admin-reset-pin` and its `ResetPinDialog` are unchanged since `ef8b2fc`.

Nothing is Critical. One High: the launch process can confuse dev and prod, and the CLI's "production" label gives no
protection (7a). The Medium items are a login pre-hydration submit that puts the PIN in the URL (and is the plausible local
"wrong PIN" flake, 7b), the orders-screen URL race (7c), and a blind spot in the staff-money test.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 4 |
| Low | 9 |

---

## High

### H1. Dev and prod can be confused at launch; the CLI's "production" label is not ours and protects nothing (item 7a)
- **Where:** Supabase CLI v3 output; `supabase/.temp/*` (link state); RUNBOOK §2 "الربط" and §17 step 1–4;
  `scripts/lib/db.mjs` (`DEV_PROJECT_REFS`); `scripts/admin-break-glass.mjs`.
- **Finding (why it says "production"):** nothing in the repo sets it. `supabase/config.toml` has no `[remotes]` or branching
  section and no "production" string (the only hit is an SMTP comment); `supabase/.temp/linked-project.json` is
  `{"ref":"ghcohlrzvehtcettaaiu","name":"mukhdar-dev"}`. CLI v3 prints the **target environment from the Supabase
  Management API**, and for a project without branching that is always its default branch, labelled `production`:
  ```
  $ supabase branches list
  Target: project mukhdar-dev (ghcohlrzvehtcettaaiu) · production
  {"target":{"kind":"linked","project_ref":"ghcohlrzvehtcettaaiu","project_name":"mukhdar-dev","environment":"production"}}
  ```
  So every project (dev and the future prod) will be labelled "production". The label can't tell them apart.
- **Problem:** the runbook's launch procedure links the production project **into the same checkout** (§17 step 1:
  `supabase link --project-ref <prod-ref>`, "relink dev after"), then runs `db push --remote --yes` and five
  `functions deploy … --yes`. The only guard is in our own scripts (`db:test:remote`, `seed:*`, `db:concurrency` refuse a
  non-dev ref). Plain `pnpm exec supabase …` commands have no guard. If the owner forgets to relink dev, the next routine
  `pnpm exec supabase db push --remote --yes` (RUNBOOK §3, used after every task) goes to **production**, and so does any
  `functions deploy` from §11/§14/§16. Going the other way, a forgotten relink to dev makes a "production" deploy land on dev
  while the screen still says `· production`.
- **Impact:** an untested migration or Edge Function applied to production. A migration can't be undone automatically
  (CLAUDE.md: never edit an applied migration). The break-glass script already prints "(NOT the known development project:
  production?)", but nothing else does.
- **Fix (scripts + docs, no migration, no redeploy):**
  1. `scripts/sb.mjs` (`pnpm sb …`), the **only** documented way to call the CLI for remote work. It reads
     `supabase/.temp/linked-project.json`, classifies the ref against **two** allowlists in `scripts/lib/db.mjs`
     (`DEV_PROJECT_REFS`, new `PROD_PROJECT_REFS`), and prints a one-line banner first:
     `TARGET: DEV mukhdar-dev (ghcohl…)` or `TARGET: *** PRODUCTION *** mukhdar-prod (<ref>)`. For a production ref and any
     mutating subcommand (`db push`, `functions deploy`, `secrets set`, `migration repair`, `config push`) it refuses unless
     `MUKHDAR_TARGET=prod` is set **and** the user types the ref interactively (same TTY guard as break-glass). It strips
     `--yes` for production. An unknown ref is always refused.
  2. Never link production in the dev checkout. RUNBOOK §17: keep a separate clone or worktree for production
     (`git worktree add ../mukhdar-prod main`), link prod only there, and run `pnpm sb` from it. The dev checkout stays
     linked to mukhdar-dev for good. Remove "relink dev after" from the runbook.
  3. Name the production project **`mukhdar-prod`** (the name shows in the banner, `projects list` and the dashboard) and
     record its ref in `PROD_PROJECT_REFS` in the same commit that creates it.
  4. RUNBOOK §3/§11/§14/§16/§17: replace `pnpm exec supabase …` with `pnpm sb …`. Add a line explaining that the CLI's
     `· production` means "default branch" and must not be read as the environment.
  5. Tests: `node --test` for the classifier (dev ref → DEV, prod ref + mutating command without `MUKHDAR_TARGET` → refused,
     unknown ref → refused).
- **Needs:** script + RUNBOOK change only. Must be done **before** T24 (release).

---

## Medium

### M1. Login can submit natively before hydration and put phone + PIN in the URL; this is the plausible local "wrong PIN" flake (item 7b)
- **Where:** `apps/admin/src/app/login/LoginForm.tsx`; `apps/admin/e2e/helpers.ts` (`signIn`);
  `apps/admin/e2e/access.spec.ts:41`.
- **CI evidence:** across the last 40 CI runs, `wrong PIN shows the Arabic error` failed **once**, in run `43758893685`
  (commit `9bbe6f0`, T16's first push, 2026-11-15), with `Received: "حدث خطأ غير متوقع، حاول مرة ثانية"`. That failure was
  GoTrue rejecting phone sign-in before the phone provider was enabled for the local stack (fixed in `ba4f056`), not a
  hydration race. No later run shows a failure or a retry of this test. So in CI the test is not flaky today.
- **Problem (the latent race, real locally under `next dev`):** the form is server-rendered with `<form noValidate>` and no
  `method`/`action`, and its inputs have `name="phone"` and `name="pin"`. Until React hydrates, `onSubmit` is not attached.
  Playwright's `fill` + `click` (or a user pressing Enter on a slow connection) then triggers a **native GET submit** to
  `/login?phone=07…&pin=123456`. The page reloads at `/login` with no error element. The test then waits 5 s for
  `login-error` and fails, while its `toHaveURL(/\/login/)` check still passes. Under `next dev` (compile on first request,
  slow hydration) this is the likely source of the local flake.
- **Impact:** besides the flaky test, a real user on a slow mobile connection who submits within the first second gets
  their **phone and PIN in the URL**. That ends up in browser history, Vercel/edge request logs and any proxy logs. For an
  admin PIN that is a credential leak. They also see the form silently clear.
- **Fix (admin UI + e2e, no migration, no redeploy of functions):**
  1. `<form method="post" action="/login" …>` so a pre-hydration submit never puts fields in the URL (a POST to the page
     just re-renders it), **and** render the submit button `disabled` until mounted
     (`const [ready, setReady] = useState(false); useEffect(() => setReady(true), [])`), with `data-ready={ready}` on the
     form. Drop the `name` attributes (state is controlled; `autoComplete` keeps password managers working).
  2. `signIn` helper: `await expect(page.locator('form[data-ready="true"]')).toBeVisible()` before filling.
  3. Optional: map `phone_provider_disabled` in `authError` to a clear Arabic message (setup error), so a misconfigured
     environment doesn't show as "unexpected error".
  4. Vitest: the button is disabled before the mount effect runs. Playwright: `page.route` delays the JS chunk and asserts
     the URL never contains `pin=`.

### M2. Orders screen: rapid filter changes drop each other (same race as the one fixed on `/ratings`) (item 7c)
- **Where:** `apps/admin/src/features/orders/OrdersScreen.tsx` `setParams` and the search debounce effect.
- **Problem:** `setParams` builds the next query from `params` (the `useSearchParams()` snapshot of the **current render**)
  and calls `router.replace`, which is asynchronous. Two changes before Next re-renders (e.g. pick a driver, then a day; or
  click a tab while typing) both start from the same old snapshot, so the second one **reverts** the first. The search
  debounce makes it worse: its 350 ms timer closes over the `setParams` (and `params`) of the render in which the user
  typed, so changing driver/tab/day within 350 ms of typing is undone when the timer fires. Also, a tab click clears `q` in
  the URL but not the `searchInput` state, so the box keeps showing a search that is no longer applied.
- **Impact:** staff see a list filtered differently from what they selected (e.g. the driver filter silently gone). No data
  is changed, but someone working a busy queue can act on the wrong list.
- **Fix (admin UI only):** use the `/ratings` pattern. Read `new URLSearchParams(window.location.search)` **at call time**
  and write with `window.history.replaceState(null, '', url)` (Next ≥ 14.1 syncs `useSearchParams` with it). Clear
  `searchInput` when the URL's `q` changes (`useEffect(() => setSearchInput(filters.search), [filters.search])`, guarded
  while typing). Better: move `setParams` into a shared `useUrlParams()` hook in `src/lib` used by Orders, Ratings and any
  later screen, so the fix can't drift again. Playwright: choose driver + day with no wait between them and assert both are
  in the URL and the list; type a search, then click a tab within 300 ms, and assert the tab wins and the box is empty.

### M3. The staff-money "RPC classifier" can't see `jsonb`/`record` results, so a new money-returning function would pass silently (item 9)
- **Where:** `supabase/tests/21_staff_money.sql` §5 (the two `set_eq` over `pg_get_function_result`).
- **Problem:** the classifier flags a function only if its **result type text** matches `(_iqd|cost|profit|revenue|price)`
  or is one of four row types. `report_summary`, `dashboard_today` and `ratings_summary` return `jsonb`, so they are
  invisible to it. `report_summary` is only caught by the `report\_%` name rule, and `dashboard_today` only by the explicit
  check that lists today's 7 money keys. A future `jsonb` RPC (e.g. a "driver earnings" or "today's cost" function), or a new
  money key added to `dashboard_today` (`cost_iqd`, `gross_profit_iqd`, `fees_iqd`…), is not caught: the explicit key list
  doesn't know it, and the regex check only looks for `cost|profit` followed by a number.
- **Impact:** the test that CLAUDE.md names as the staff-money guarantee lets through the most likely kind of regression
  (one more key in a JSON payload).
- **Fix (test only, no migration):**
  1. Add a third `set_eq`: every `public` function executable by `authenticated` whose result is `jsonb`, `json`, `record`,
     `setof record` or `void` must appear in an explicit, reviewed list (today: `dashboard_today`, `ratings_summary`,
     `report_summary`, `place_order`, `rate_order`, …). A new one fails the test until it is classified, the same way §1
     does for columns.
  2. Replace the `dashboard_today` key list with a structural check: as staff,
     `select count(*) from jsonb_each(public.dashboard_today()) where key ~ '(_iqd|cost|profit|revenue|sales|fees?|waste)'
     and jsonb_typeof(value) <> 'null'` must be 0 (and the same over `jsonb_path_query(…, 'strict $.**')` for nested
     objects).
  3. Call `ratings_summary()` and `ratings_list()` as staff and assert no key/column matches the money regex.

### M4. Realtime refresh is a trailing-only 250 ms debounce: under a steady stream of order events the panel never refreshes (item 6)
- **Where:** `apps/admin/src/components/PanelProviders.tsx` (`invalidate`), which drives Home (`dashboardKeys` live under
  `['orders']`), the orders list and counts, and the sidebar badge.
- **Problem:** each event clears and restarts a 250 ms timer, so refetch happens only after a **quiet** 250 ms. During a
  burst (lunch peak, the k6 run in T22, a driver app sending updates in a loop) with events less than 250 ms apart, nothing
  refetches until the burst ends. The 60 s polling on Home is the only fallback, and the orders page has none. In the other
  direction, every event refetches `dashboard_today()` (8 statements) plus every active `['orders']` query (all loaded pages
  of the infinite list) in **every** open admin/staff tab. That is fine at today's volume but grows linearly with tabs × events.
  The design deviation (README "Home" 7) says the task's 2 s debounce was intentionally not added.
- **Impact:** at the busiest moments the Home cards and the orders list freeze. That is when staff rely on them most.
- **Fix (admin UI only):** throttle with a max wait: refetch at most once per 1 s and at least once every 2 s while events
  keep arriving (leading + trailing, `maxWait = 2000`). Refetch only **active** queries (`refetchType: 'active'`, the
  default). For Home, invalidate `dashboardKeys.today` at most every 2 s (the task's figure) instead of riding the 250 ms
  orders timer. Vitest with fake timers: 20 events 100 ms apart cause ≥ 1 refetch within 2 s and ≤ 3 in total.

---

## Low

### L1. CSV export has no formula-injection guard (item 4)
- **Where:** `apps/admin/src/features/reports/csv.ts` (`cell`).
- **Problem:** text cells are only quoted for `" , CR LF`. A product name like `=HYPERLINK("http://…","x")` or one that
  starts with `+ - @` or TAB is written as is, and Excel/LibreOffice evaluate it when the waste CSV is opened. Today the
  only free text in either CSV is the **product name**, which only admins can write. Comments and customer names are not
  exported. So the attacker would have to be an admin (or a hijacked admin session) targeting another admin. Numbers are
  safe (negative net profit `-5000` must stay numeric).
- **Fix (admin UI only):** in `cell`, for `typeof v === 'string'` starting with `= + - @ \t \r`, prefix `'` (OWASP); never
  touch `number` cells. Vitest: `=1+1` → `'=1+1`, `-5000` (number) unchanged, `"-x"` (string) → `'-x`. Apply the same
  helper to any future export (ratings, orders).

### L2. Rating comments keep invisible/bidi control characters
- **Where:** `public.rate_order` (sanitizing regex), `RatingsScreen` / `ReportsScreen` (comment rendering).
- **Problem:** the regex removes C0 controls except TAB/LF/CR and DEL, but not C1 (`U+0080–009F`), zero-width
  (`U+200B–200F`, `U+FEFF`), line/paragraph separators (`U+2028/2029`) or **bidi overrides/isolates**
  (`U+202A–202E`, `U+2066–2069`). React escapes HTML, so this is not XSS, but in an RTL page a customer can make a comment
  render reversed or appear to continue into the next field ("Trojan Source"-style spoofing). CR is also kept.
- **Fix (migration when next touched + UI now):** extend the class to
  `[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F​-‏ -‮⁠-⁩﻿]` and fold CR into LF. In the UI, wrap
  the comment and customer name in `<bdi>` / `unicode-bidi: isolate` so stored rows written before the fix are contained.
  pgTAP: a comment with `U+202E` is stored without it.

### L3. Deleted customers' names still appear next to their comments
- **Where:** `public.ratings_list` (`o.customer_name` from the order snapshot); `ratings.customer_id on delete set null`.
- **Problem / impact:** snapshots on orders are kept on purpose (SPEC-backend §4 "لماذا نسخ"). But T26 adds a new screen
  that shows a deleted customer's **name next to their free-text opinion**, which is personal data with no accounting need
  after the account is deleted. App-store review and privacy policy both promise deletion.
- **Fix (migration):** in `ratings_list` return
  `case when r.customer_id is null then null else o.customer_name end` and show "زبون محذوف" in the UI. Document it in
  SPEC-backend assumption 61. pgTAP: delete the profile → name is null, comment still listed.

### L4. Redundant index on `ratings`
- **Where:** `ratings_created_idx (created_at desc)` (init) and `ratings_keyset_idx (created_at desc, order_id desc)` (T26).
- **Problem / impact:** the keyset index serves every query the old one did (same leading column). It's an extra write and
  extra space on each rating. Negligible now.
- **Fix (migration, when next touched):** `drop index public.ratings_created_idx;` and update `01_schema.sql`.

### L5. Performance check doesn't cover Home or Ratings
- **Where:** `scripts/report-perf.mjs` (only the six `report_*` functions); T25/T26 acceptance "< 1 s on seed data".
- **Problem:** `dashboard_today()` (7 range counts + open counts + low stock + `daily_stats`), `ratings_summary` with no range
  (full scan of `ratings`) and `ratings_list` keyset pages are not timed at volume, and the report page's `ratings_list`
  comments call is outside the page budget. By reading the definitions, every range query matches a partial index
  (`orders_delivered_at_idx`, `orders_cancelled_at_idx`, `orders_created_idx`, `orders_status_created_idx`,
  `ratings_keyset_idx`), but nothing proves the plans at 200k orders.
- **Fix (script only):** seed ratings in `report-perf` (e.g. 60% of delivered orders) and add `dashboard_today` (as admin
  via `set local request.jwt.claims`), `ratings_summary()` (all time and month) and `ratings_list` first + 10th page, with
  limits 300 ms / 300 ms / 100 ms. Count the comments call in the reports page total.

### L6. Ratings page refetches every loaded page every 60 s
- **Where:** `RatingsScreen` (`useInfiniteQuery` with `refetchInterval: 60_000`).
- **Problem / impact:** TanStack refetches **all** loaded pages in sequence. After "عرض المزيد" ×10, that's 10 sequential
  RPCs per minute per open tab. Not a problem today, but this is the only polling screen that grows with use.
- **Fix:** poll only the summary and the first page (`refetchInterval` on the summary; for the list use
  `maxPages` or reset to page 1 on poll), or drop list polling. New ratings are rare and the task's acceptance says "appears
  after refresh".

### L7. Access tests are per-role samples, not a matrix
- **Where:** `24_reports.sql` (customer/driver/anon tested on 1–2 of the 6 report functions; **deactivated admin** not
  tested at all), `25_dashboard.sql`, `26_ratings.sql` (`ratings_list` not tested for anon).
- **Problem / impact:** the shared guards make this safe today. A future function with its own copy of the check (or a
  missing `perform private.report_guard`) would only be caught if someone remembers to add a test.
- **Fix (tests only):** a table-driven block in `21_staff_money.sql` or a new `27_access_matrix.sql`: for each new RPC ×
  {anon, customer, driver, flagged admin, deactivated admin, flagged staff, deactivated staff}, `throws_ok … '42501'`.
  Plus a catalog check that every `SECURITY DEFINER` function in `public`/`private` has a `search_path` in `proconfig`
  (holds live today for all of them).

### L8. Cancel-without-return unit cost when a product's lines are only partly costed
- **Where:** `set_order_status` no-return branch.
- **Problem / impact:** the waste unit cost is `Σ(cost×qty) / Σqty over lines that have a cost row`, then multiplied by the
  **total** qty of that product. If an order had two lines of the same product and only one had an `order_item_costs` row,
  the uncosted qty would be valued at the average instead of 0 (L4(b)'s rule). It can't happen for orders made by
  `place_order` (one cost row per line, always), and dev has 0 uncosted lines and 0 duplicate product lines. Theoretical.
- **Fix (migration, when next touched):** compute `Σ(coalesce(cost,0)×qty) / Σqty`. No action needed now.

### L9. Docs drift (item 8)
- `docs/DRIVER-API.md` "Changes for the driver app" lists `20261127000001` and `20261128000001` as having no driver-facing
  change but **omits `20261126000001`** (T20). Add it: report RPCs are admin-only (drivers `NOT_ALLOWED`) and
  `order_items.product_id` / `inventory_movements.product_id` became `on delete restrict` (not visible to drivers).
- RUNBOOK §17 row 28 says "تغيّر توقيع `rate_order`". The **signature did not change** (`p_order_id, p_stars, p_comment` →
  `void`). Its **behaviour** changed (new errors `COMMENT_TOO_LONG`, `PIN_CHANGE_REQUIRED`, `NOT_ALLOWED` for deactivated
  accounts; trimmed comment). Reword.
- RUNBOOK §8 still says "24 files, 916 checks after T20". There are 26 files now; update the count after T26. The §17 heading
  still says "(مراجعة الجلستين A وB)" while it now covers T20–T26.
- `docs/design/README.md` has **two "Ratings" rows** in the admin screens table (lines 94–95); delete the first.
- SPEC-admin assumption 22 says the last 20 comments are "a direct read of `ratings` (RLS)". Since T26 they come from
  `ratings_list` (SPEC-backend §12.3 says so). Align the text.
- **RUNBOOK §17 lists all 28 migrations in the right order**, matching `supabase/migrations/` and the 28 rows in
  `supabase_migrations.schema_migrations` on mukhdar-dev. No change needed there. SPEC assumptions 59–61 and the design
  deviations for Home (8) and Ratings (8) are recorded and match the code.

---

## Checked and OK (no finding)

1. **Money definitions (item 1):** sales = Σ `subtotal_iqd` of `delivered` orders by Baghdad `delivered_at` day, no fee,
   in `daily_stats` (via `_bump_daily_stats` and `rebuild_daily_stats`), `dashboard_at` (direct) and `report_top_products`
   (line totals; Σ line totals = subtotal by the `order_items_check` constraint). Net profit = gross − waste − negative
   adjustments (`daily_stats.net_profit_iqd` is a generated column). `avg_order` = sales ÷ delivered, rounded to the dinar,
   `null` without deliveries, in both Home and Reports. Fees appear only as `delivery_fees_iqd` "for information".
   Recomputation on dev: **0 differing days.**
2. **Day boundaries:** every range uses `private.baghdad_start(day)` (`day::timestamp at time zone 'Asia/Baghdad'`),
   half-open `[start(from), start(to + 1))`; ratings by `ratings.created_at` (assumption 59(4)). `report_guard` caps 366
   days; `ratings_guard` 3650 or open.
3. **Staff money (item 2):** `21_staff_money.sql` covers all six `report_*` (refused), `stuck_notifications_count`
   (refused), `dashboard_today` (money + `stuck_notifications` null), and the table-level checks. `ratings_summary`/`ratings_list`
   carry no money (stars, comment, order number, customer name). Staff Home shows no "د.ع" (no total column; design
   deviation 1). The gap is M3.
4. **Access (item 3), live:** `report_summary/daily/orders_placed/top_products/drivers/waste`, `dashboard_today`,
   `ratings_summary`, `ratings_list`, `rate_order`, `stuck_notifications_count`: `prosecdef = true`,
   `search_path=""`, `anon` execute = false. `private.dashboard_at`, `ratings_stats`, `ratings_guard`, `report_guard`,
   `orders_placed`, `stuck_count`, `bump_daily_losses`, `rebuild_daily_stats`: no execute for `anon`/`authenticated`/`public`.
   The role helpers return null/false for anon. RLS on `ratings`: own rows or staff/admin; drivers none. No
   insert/update/delete grant on `ratings`, `daily_stats`, `inventory_movements` for `authenticated` (the ledger can't be
   edited around the `daily_stats` triggers).
5. **Ratings rules (item 4):** `rate_order`: authenticated, active, not flagged; stars 1..5 (also a table check); own order
   **and** `status = 'delivered'`; once (`ratings_pkey (order_id)` + `on conflict do nothing` → `ALREADY_RATED`, race-safe);
   comment trimmed, C0 controls stripped, empty → null, > 500 → `COMMENT_TOO_LONG` (table check `≤ 500` too;
   `ratings_comment_plain` `not valid` for old rows). Comments are rendered only as React text (no
   `dangerouslySetInnerHTML` anywhere in `apps/admin/src`), and the customer app renders them with `Text`. Comments are not
   in any CSV (L1 covers names).
6. **Session C (item 5):** see Summary. Additionally `dashboard_today` / `ratings_*` / `report_*` refuse flagged and
   deactivated accounts through `current_user_role()` (tested for flagged admin/staff and deactivated staff).
7. **Performance (item 6):** Home = 3 requests (`dashboard_today`, today's orders with `LIST_COLUMNS` and no embeds,
   `store_open`) + 60 s polling. Reports = 6 parallel RPCs per range, refetched only when the range changes (`e9cfc57`).
   Ratings = 2 RPCs per filter change. No N+1 (no per-row calls; driver names come from one `list_drivers`). Indexes match
   predicates: `orders_delivered_at_idx`/`orders_cancelled_at_idx` (partial on status), `movements_losses_created_idx`
   (partial, same predicate as `report_waste`), `ratings_keyset_idx` (keyset order). `report-perf` in CI: 200k orders,
   month < 500 ms per call, page < 1 s, year < 2 s. Realtime: only `orders` is published; the panel holds **one** channel
   per tab (`panel-orders`). Load concerns are in M4/L5/L6.
8. **Indexes are used:** the T20 `--explain` diagnostic and CI timings cover the report functions. Home/Ratings rely on
   the same index shapes (L5 asks for the proof).

---

## Ordered fix list

| # | Item | Severity | Where | Migration | Redeploy |
|---|---|---|---|---|---|
| 1 | **H1** dev/prod target guard (`pnpm sb`, `PROD_PROJECT_REFS`, separate prod worktree, `mukhdar-prod` name, RUNBOOK) | High | `scripts/sb.mjs`, `scripts/lib/db.mjs`, RUNBOOK §2/§3/§11/§14/§16/§17 | No | No (before T24) |
| 2 | **M1** login: `method="post"`, button disabled until hydrated, no `name` on fields; e2e waits for `data-ready` | Medium | `LoginForm.tsx`, `e2e/helpers.ts`, `authError` | No | Admin panel only (not yet deployed) |
| 3 | **M3** staff-money test sees `jsonb`/`record` RPCs; structural money-key check on `dashboard_today`; ratings RPCs as staff | Medium | `21_staff_money.sql` | No | No |
| 4 | **M2** shared `useUrlParams` (read `window.location` at call time, `history.replaceState`) for Orders (and Ratings); sync `searchInput` | Medium | `OrdersScreen.tsx`, `RatingsScreen.tsx`, `src/lib` | No | Admin panel only |
| 5 | **M4** Realtime throttle with max wait; Home invalidation ≤ every 2 s | Medium | `PanelProviders.tsx`, `dashboard/api.ts` | No | Admin panel only |
| 6 | **L1** CSV formula-injection prefix for text cells | Low | `reports/csv.ts` | No | Admin panel only |
| 7 | **L7** access matrix + `search_path` catalog check | Low | new `27_access_matrix.sql` | No | No |
| 8 | **L5** `report-perf` covers `dashboard_today` and ratings | Low | `scripts/report-perf.mjs` | No | No |
| 9 | **L2 + L3 + L4** one migration: wider control-char strip in `rate_order`, `ratings_list` hides deleted customers' names, drop `ratings_created_idx`; UI `<bdi>` | Low | new migration, `RatingsScreen`, `ReportsScreen`, pgTAP `26`, `01` | **Yes** (one new migration; apply to dev with owner approval, add as row 29 in RUNBOOK §17) | No Edge Function |
| 10 | **L6** ratings polling: summary + first page only | Low | `RatingsScreen.tsx` | No | Admin panel only |
| 11 | **L9** docs drift (DRIVER-API T20 line, RUNBOOK row 28 wording, §8 counts, §17 heading, design README duplicate row, SPEC-admin assumption 22) | Low | docs | No | No |
| 12 | **L8** partial-cost average in cancel-without-return | Low | `set_order_status` | Yes (only when next touched) | No |

Items 1–8 and 10–11 need no migration and no Edge Function redeploy. The admin panel isn't deployed yet (SPEC-admin
assumption 16), so "admin panel only" means a code change that ships with the first Vercel deploy. Item 9 is the only
database change; group it with T22/T23 work to avoid an extra migration.
