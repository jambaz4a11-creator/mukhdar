# T22: load / stress test (`scripts/load/`)

Runs against **mukhdar-dev only** (the scripts refuse any other linked project). Everything it creates is throwaway and is
deleted at the end; the script then proves zero leftovers. Results of the last full run: [`docs/reviews/load-test-T22.md`](../../docs/reviews/load-test-T22.md).

> Deviation from `docs/tasks/22-load-test.md` (decided by the project owner for this session): Node scripts instead of k6,
> the free-tier dev project instead of a Pro staging project, and the realistic Bismayah peak (60 concurrent customers,
> ~200 orders/hour, x3 spike) instead of 300/500/200 virtual users. Dev results are **pessimistic** versus a paid prod plan
> (Nano compute, Singapore region, and the client sits on a WAN link).

## Commands

```bash
pnpm load:run -- --smoke   # ~6 minutes, tiny scale: validates the harness and the cleanup
pnpm load:run              # full run, ~55 minutes (most of it is paced sign-in, see below)
pnpm load:cleanup          # manual cleanup if a run was killed (idempotent)
node --test scripts/load/lib.test.mjs   # unit tests of the pure parts (also part of `pnpm test`)
```

Needs `.env.local` (`SUPABASE_DB_PASSWORD`, `SUPABASE_SERVICE_ROLE_KEY`) and `apps/customer/.env` (publishable key), as the
other `it:*` scripts. `service_role` is used only by this dev script, only for the Admin API (create/delete throwaway users).
Flags: `--customers= --factor= --drivers= --orders-per-hour= --base-min= --spike-min= --drain-min= --signin-per-5min= --race=`.

## What it simulates

| Actor | Model |
|---|---|
| 60 customers (x3 = 180 in the spike) | browse the catalog (categories, product pages, search, own orders; think time 5-12 s), place orders as a Poisson process (200/h, x3 = 600/h in the spike) with 1-8 items, read settings + addresses first like the app, subscribe over Realtime to their own order (`id=eq.`) until it is final, 3% cancel while pending, 50% rate after delivery |
| 3 drivers (x3 = 9) | poll `available_orders` every 3-6 s, all pick the **oldest** order (maximum contention), hold at most 2, then `out_for_delivery` -> `delivered` |
| staff panel (Orders) | Realtime INSERT/UPDATE + 5 s polling, refetch debounced 500 ms / max 2 s (as `PanelProviders.tsx`); moves orders `preparing` -> `ready`, 20% get a driver assigned first |
| admin panel (Home) | Realtime + 60 s polling of `dashboard_today`, today's orders, store state |

Order lifecycle timers are **compressed** (seconds, not the real 30+ minutes) so every order completes inside the run; this
makes status-change traffic higher than reality.

## Phases

1. **Setup**: snapshot of the whole DB state (`.run/before.json`, git-ignored), throwaway users (phone prefix `9647006`,
   not the demo/seed/IT prefixes) created through the **Admin API** (no sign-up rate limit), throwaway category + 31 products
   (`LOADTEST ...`, stock via the real ledger path `private.apply_stock_movement`, one scarce product with stock 7), one
   address each on an existing active building.
2. **Paced sign-in**: GoTrue limits sign-ins to 30 per 5 minutes per IP. Tokens are acquired at <= 27/5 min in the order
   the test needs them (about 38 minutes for 191 users) while the earlier phases already run; a 429 backs off instead of failing.
3. **A, correctness under concurrency** (not judged on speed): oversell race (24 customers, stock 7), max-open-orders (6
   parallel orders of one customer -> exactly 3), idempotency (4 parallel identical keys -> 1 order), store closed (toggled
   in a transaction that keeps `updated_at`, restored in `finally`), driver accept race (4 orders x 3 drivers, simultaneously).
4. **base**: the realistic peak. **spike**: x3. **drain**: wait until every load order is `delivered`/`cancelled`.
5. **Verify**: stock ledger = balance and never negative; per-order movements match items (cancel nets to 0); one driver per
   dispatched order, one `driver_accepted` row at most; exactly one admin notification per order; exactly one ready-notification
   per order that reached `ready` (drivers `new_order` XOR assigned-driver `ready`); order totals computed by the DB; zero
   deadlocks; `daily_stats` equals a recomputation from raw rows (`STATS_MISMATCH_SQL`) and survives a full
   `rebuild_daily_stats` (inside a rolled-back transaction); `dashboard_today()` and `report_summary(today)` equal an
   independent recomputation (counts, sales, open counts, waste, net profit); Realtime delivered every order event to the admin panel.
6. **Cleanup + proof**: deletes notifications, movements, orders, addresses, products, category, users; rebuilds the affected
   `daily_stats` days and restores `updated_at`; restores `app_settings`; then compares a snapshot of every public table's
   row count and content hashes (settings, stock, products, costs, profiles, orders, movements, daily_stats) plus the
   auth tables, and counts outbox rows created since the start. Any difference fails the run.

## Pass / fail

Defined in `lib.mjs` (`THRESHOLDS`) and unit-tested.

- base: p95 < 1000 ms for every operation, unexpected errors < 1%. spike: p95 < 2000 ms, unexpected errors < 1%.
  Operations with < 20 samples are reported but not judged.
- **Expected business refusals are not errors** (`EXPECTED_REFUSALS`): `INSUFFICIENT_STOCK`, `TOO_MANY_ACTIVE_ORDERS`,
  `STORE_CLOSED` for `place_order`; `ORDER_NOT_AVAILABLE` for `accept_order`; `INVALID_TRANSITION` for status changes. Anything
  else (5xx, 429, timeouts, other codes) counts as an unexpected error.
- Any failed correctness check is an absolute failure regardless of speed.
- Informational only (not gating on the free tier): the prod targets from the task file (`place_order` p95 < 500 ms, catalog < 300 ms).

Latency is measured **client-side** (includes the WAN round trip); the report also prints the idle network floor and the
server-side mean from `pg_stat_statements`.

## Safety

- **No real push notifications.** The run refuses to start if `push_tokens` is non-empty, throwaway users never register a
  token, and `push_tokens` is sampled every 5 s (the run aborts if a real device registers). With zero tokens `push-dispatch`
  has nobody to send to. (Outbox rows are still written and the Edge Function is still invoked by the existing trigger.)
- Never changes migrations, Edge Functions or settings, other than toggling `store_open` for the closed-store check
  (restored, including `updated_at`).
- Not restorable by design: identity sequences (`order_number`, ids) advance; `net._http_response` and `cron.job_run_details`
  are infrastructure logs that Supabase purges by itself.

## Not covered

- `BELOW_MIN_ORDER`: needs a non-zero `min_order_iqd`, i.e. a settings change that this session may not make (pgTAP `03_place_order.sql` covers it).
- DB CPU: not visible from SQL on the hosted project. Connections (`pg_stat_activity`), lock waits and deadlocks are sampled; read CPU from Dashboard > Reports > Database for the run window.
- `EXPLAIN ANALYZE` of the heaviest statements: the run prints the top statements by total time (`pg_stat_statements` delta); explain them by hand if one looks wrong.
