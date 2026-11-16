# T22: load / stress test results (mukhdar-dev)

Date: 2026-11-17. Scripts: [`scripts/load/`](../../scripts/load/README.md). Target: **mukhdar-dev** (free tier, Nano compute,
Singapore), driven from a Windows machine over the public internet. Dev numbers are **pessimistic** versus a paid prod
plan in Frankfurt; they say nothing about prod absolute latency, but the correctness results transfer fully (same SQL).

## Verdict

| Area | Result |
|---|---|
| **Correctness under load** | **PASS in both full runs, no bug or race found.** No overselling, ledger = balance, limits respected, exactly one driver per order, ready-notification exactly once, dashboard/report numbers equal an independent recomputation, `daily_stats` rebuild identical, 0 deadlocks. |
| **Cleanup** | **PASS.** Zero leftovers; settings, stock, daily_stats, every public table's row count and content hashes equal the pre-run snapshot. No push token ever existed. |
| **Latency thresholds** | **Not met consistently on dev.** p50 of every operation sits at the network floor (~255 ms), but intermittent multi-second stalls hit all operations at the same moment (run 1 spike, run 2 base). Run 1: base pass, spike fail on 3 ops. Run 2: spike pass, base fail on 2 ops. |

By the task's rule ("if thresholds are not met: fix, then re-run") T22 stays **open** (not marked done): the fix candidates are infra
(Compute size, region), which this session was not allowed to change. Re-run the same script on the production-sized project
before launch (`pnpm load:run`, ~55 min).

## What was run

Two full runs (`pnpm load:run`, ~55 min each) plus three small smoke runs used to debug the harness.

- 60 customers browsing + ~200 orders/hour, 3 drivers, staff panel on Orders, admin panel on Home (Realtime + polling): 15 min.
- Then x3: 180 customers, 600 orders/hour, 9 drivers: 3 min.
- Before the load, a correctness phase A (concurrent bursts), after it a drain and database verification.
- 191 throwaway users (phone prefix `9647006`) created through the Admin API (no sign-up limit), signed in at <= 27 per 5 minutes
  (191 sign-ins, **zero 429**). 31 throwaway products (`LOADTEST ...`), one scarce product with stock 7.
- Orders placed: run 1 = 107 (A 13, base 63, spike 31); run 2 = 89 (A 13, base 39, spike 37). Order lifecycle timers are compressed.
- Not run: `BELOW_MIN_ORDER` (needs a non-zero `min_order_iqd`, a settings change that was not allowed; covered by pgTAP `03_place_order.sql`).

## Correctness (both runs: all pass)

| Check | Outcome |
|---|---|
| A0 oversell race: 24 customers, stock 7 (1 or 2 units each) | 5 won (exactly 7 units), 19 `INSUFFICIENT_STOCK`, final stock 0, no wrongful refusal |
| A1 max open orders: 6 parallel orders, one customer | exactly 3 OK + 3 `TOO_MANY_ACTIVE_ORDERS` |
| A2 idempotency: 4 parallel orders, same key | 1 order in the DB, 3 replays returned the same order |
| A3 store closed: 10 concurrent | all `STORE_CLOSED`; no order, no stock change; store restored (incl. `updated_at`) |
| A4 driver race: 4 ready orders x 3 drivers at once | each order exactly 1 winner, 2 `ORDER_NOT_AVAILABLE`; one driver per order |
| Ledger vs balance, never negative (31 products) | pass |
| Per-order movements = items (cancel nets to 0) | pass (107 / 89 orders) |
| One `driver_accepted` row at most; every dispatched order has a driver | pass |
| New-order admin notification exactly once per order | pass |
| Ready notification exactly once (drivers `new_order` XOR assigned-driver `ready`; none if never ready) | pass |
| Order totals computed by the DB (subtotal = round(sum of items), total = subtotal + fee) | pass |
| `daily_stats` = recomputation from raw rows (review check, all 30 days) | pass |
| Full `rebuild_daily_stats` over all history leaves `daily_stats` identical (waste, adjust, net included) | pass |
| `dashboard_today()` = independent recomputation (counts, sales, open counts, waste, net profit) | pass |
| `report_summary(today)` = recomputation (sales, net profit, waste) | pass (sales 1,748,750 / 1,233,000 IQD) |
| Zero deadlocks (`pg_stat_database`) | 0 |
| Realtime: admin panel received every order INSERT/status UPDATE | run 1: 508/509 (the one miss was a harness race, see below; not re-measured); run 2: 434/434 |

Harness issues found and fixed on the way (all were test-script bugs, none in the product): a customer already at the order
limit in the closed-store burst (the limit is checked before the store state), an `NOT_ALLOWED` for a customer cancelling after
the staff started preparing (a legitimate business refusal, now classified separately), the `tracked` filter dropping an INSERT
event that arrived before `place_order` returned (this was the single "lost" Realtime event in run 1), and a panel poll that
fired after cleanup had deleted the admin user.

## Latency (client-side, ms; includes the WAN round trip; n = samples)

Idle network floor (GET of one row): **p50 253-267 ms, p95 ~540-685 ms.** Server-side the DB is nearly idle.

| Operation | Run 1 base p50/p95/p99 (n) | Run 1 spike p50/p95/p99 (n) | Run 2 base p50/p95/p99 (n) | Run 2 spike p50/p95/p99 (n) |
|---|---|---|---|---|
| `place_order` | 288 / 427 / 539 (63) | 404 / **2264** / 6065 (31) | 351 / **3264** / 6891 (39) | 266 / 524 / 633 (37) |
| catalog products page | 262 / 351 / 451 (3349) | 257 / 840 / 4674 (1929) | 257 / 331 / 467 (3312) | 253 / 296 / 376 (2027) |
| categories | 261 / 346 / 451 (978) | 257 / 865 / 4644 (555) | 257 / 336 / 596 (942) | 253 / 308 / 597 (594) |
| `accept_order` (incl. refusals) | 263 / 329 / 358 (58) | 289 / **2655** / 2736 (32) | 269 / **1023** / 1389 (36) | 250 / 284 / 372 (31) |
| `set_order_status` | 269 / 358 / 482 (238) | 279 / **2385** / 5650 (89) | 274 / 374 / 2951 (149) | 257 / 354 / 511 (129) |
| `available_orders` | 265 / 369 / 523 (556) | 260 / 847 / 4412 (323) | 259 / 429 / 924 (556) | 253 / 333 / 608 (339) |
| `dashboard_today` | 264 / 361 / 407 (335) | 277 / 755 / 2486 (107) | 266 / 423 / 1176 (223) | 254 / 283 / 301 (148) |
| Realtime event (action -> panel) | 556 / 817 / 1016 | 695 / 2433 / 5765 | 578 / 926 / 6316 | 576 / 781 / 1020 |

Bold = over the script threshold (base p95 < 1000 ms, spike p95 < 2000 ms). With the production targets of the task file
(`place_order` p95 < 500 ms, catalog p95 < 300 ms): run 1 base `place_order` p95 427 ms and run 2 spike 524 ms are at the target
even from a far-away client; catalog p95 330-350 ms is just above 300 ms but the floor alone is ~255 ms.

Unexpected errors: **0** in run 2; run 1 had only the harness artefact above. Expected business refusals (not errors): `INSUFFICIENT_STOCK`
19, `TOO_MANY_ACTIVE_ORDERS` 3, `STORE_CLOSED` 10 (phase A, by design), `ORDER_NOT_AVAILABLE` 8-18 per phase (drivers
all picking the oldest order), `INVALID_TRANSITION` a few (customer cancel racing staff).

## The bottleneck question: intermittent stalls, not load

Observations from both runs:

1. The stalls are **simultaneous across all operations** (browse, RPC, Realtime delivery all show a ~5-7 s max in the same
   phase) while p50 does not move. That points to one stall episode, not to a slow query.
2. It is **not the test machine**: event-loop lag was <= 158 ms with zero stalls > 500 ms.
3. It is **not DB saturation**: average active backends 2-4 (peak 13 in the drain), peak total 27 of 60 connections, **zero lock waits**,
   no gap in the 5 s monitor samples (the direct DB connection stayed responsive), 0 deadlocks.
4. It is **not load-correlated**: run 1 hit the x3 spike, run 2 hit the baseline and the spike was clean (`place_order` p95 524 ms
   at 180 customers).
5. In run 2 the staff panel's Realtime socket closed unexpectedly once (staff received 238 of 434 events; the admin panel
   received all 434). The test client does not reconnect (supabase-js does), and the staff panel kept working through its 5 s polling.

Most likely cause: free-tier/Nano platform or network jitter (API gateway / pooler / WAN path), unproven. I could not read DB
CPU from SQL; check Dashboard > Reports > Database for the two run windows (run 1 ~22:15-22:57 UTC, run 2 ~22:58-23:45 UTC on 2026-11-17).

The heaviest database work by far is **Realtime itself**: `realtime.list_changes` polling (`SELECT wal->>... as type, ...`) used
51-66 s of DB time per run (~5000 calls, 10-13 ms each), more than any application query; `dashboard_today` is next
(469-547 calls, 40 ms mean, ~19-23 s total, driven by every Realtime event refetching it on each admin panel, as designed).
With 2 panels + ~15 order sockets this is fine; it scales with orders x subscribers, so keep the "one filtered channel per
current order" rule (SPEC-backend §9).

## Recommendations

1. **Re-run `pnpm load:run` on the production-sized Pro project (Frankfurt) before launch** and judge the latency thresholds there; the thresholds in
   `lib.mjs` are sized for dev and can be tightened to the task file's 500 / 300 ms. Correctness need not be re-argued.
2. If stalls persist on Pro, look at Dashboard > Reports (API gateway, Database CPU, Realtime) for the stall windows before touching SQL: nothing in the
   DB shows contention.
3. Realtime in apps: reconnect and refetch on `CLOSED`/`TIMED_OUT` (supabase-js already does; keep the admin panel's polling fallback, it proved useful).
4. `dashboard_today` refetching on every order event is fine at this scale (40 ms mean); if panels multiply, raise the debounce.
5. Nothing to fix in the backend from this task. No migration, Edge Function or setting was changed.

## Caveats

- One run per configuration; p99 on 30-60 samples is noisy. Reported, not judged (`minSamples = 20` applies to percentiles generally).
- Sign-in pacing (27 per 5 min per IP) meant the spike started ~38 min after the start; the 10 min between base and spike were an idle drain.
- `EXPLAIN ANALYZE` of the top statements was not run (the top ones are Realtime internals and PostgREST wrappers; none is slow). `place_order`
  server-side mean was not extracted from `pg_stat_statements` (the statement is wrapped by PostgREST); the client p50 of ~270-350 ms minus the
  ~255 ms floor bounds it below ~100 ms.
- Sequences (`order_number`, ids) advanced and cannot be restored; `net._http_response`/`cron.job_run_details` are infra logs purged by Supabase.
  `push-dispatch` was invoked by the existing trigger for each outbox row and found no tokens (none existed), so nothing was sent anywhere.
