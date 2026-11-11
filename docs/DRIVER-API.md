# DRIVER-API: integration guide for the external driver app

The driver app is **built by a separate developer** and connects to this project's Supabase backend.
This document is the integration contract. It is self-contained: you should not need to read the rest
of the repo. Expected screens and UX are described in [SPEC-driver.md](SPEC-driver.md) (Arabic).

Source of truth for everything below: `supabase/migrations/` (functions `available_orders`,
`accept_order`, `set_order_status`, `register_push_token`, and the RLS policies). The behaviour is
covered by the pgTAP tests in `supabase/tests/` (`04_status_transitions.sql`, `05_driver.sql`,
`08_roles.sql`). If the code and this document disagree, the code wins and this document is a bug.

> Changes to this contract (function signatures, error codes, policies, push payloads) must be agreed
> with the driver app developer first and land as a **new** migration.

---

## 1) Connection

| Item | Value |
|---|---|
| Client | `@supabase/supabase-js` v2 (or any Supabase client: PostgREST + GoTrue + Realtime) |
| URL | `https://<project-ref>.supabase.co`, given by the project owner (dev and production are different projects) |
| Key | the project's **anon / publishable** key only |
| Language / direction | Arabic, RTL. All user-facing texts from the backend (push titles) are Arabic |
| Money | integers in Iraqi dinar (IQD), always multiples of 250. No decimals |
| Time | `timestamptz` (ISO 8601, UTC). Business days are `Asia/Baghdad` |

**Never** embed the `service_role` key in the app. Everything the driver needs works with the user's
own session; RLS and the functions enforce what a driver may see and do.

---

## 2) Authentication and role

1. **Phone + OTP** via Supabase Auth (same as the customer app):
   ```ts
   await supabase.auth.signInWithOtp({ phone: '+9647XXXXXXXXX' });            // E.164
   await supabase.auth.verifyOtp({ phone: '+9647XXXXXXXXX', token: '123456', type: 'sms' });
   ```
   Accept `07XXXXXXXXX` in the UI and convert to `+9647XXXXXXXXX`. The SMS provider for production is
   not chosen yet; in development, test phone numbers with fixed OTPs are configured in the dashboard.
2. On first sign-in a trigger creates `profiles` with `role = 'customer'`. **A new account is not a
   driver.** The admin activates it from the admin panel (`set_user_role(user, 'driver', true)`).
3. After sign-in (and on every app start / resume), read your own profile:
   ```ts
   const { data } = await supabase.from('profiles')
     .select('id, role, full_name, phone, is_active').eq('id', user.id).single();
   ```
   If `role !== 'driver'` or `is_active === false`, show "account not activated as a driver, contact
   the administration" with **Refresh** and **Sign out**. Do not call the driver functions.
4. A deactivated or demoted driver is rejected by every driver function (`NOT_ALLOWED` /
   `NOT_AUTHENTICATED`) even with a valid session, so handle those errors by re-checking the profile.
5. The driver may update only `profiles.full_name` (`update ... set full_name`); role, phone and
   `is_active` are not writable.

---

## 3) RPC functions

Call with `supabase.rpc(name, params)`. Errors come back as a PostgREST error where
**`error.message` is the error code** below (e.g. `'ORDER_NOT_AVAILABLE'`), `error.code` is the SQL
state, and `error.details` carries extra info where noted. Match on `error.message`.

### 3.1 `available_orders(p_limit int default 20)` → `setof row`

Unassigned orders a driver can take: `driver_id is null` and status `pending` or `preparing`,
oldest first. `p_limit` is clamped to 1..50.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `order_number` | bigint | number shown to people |
| `status` | `'pending' \| 'preparing'` | |
| `sector`, `subsection`, `building` | text | address without apartment |
| `item_count` | bigint | sum of quantities |
| `total_iqd` | bigint | amount to collect in cash |
| `created_at` | timestamptz | |

**No customer name, phone, apartment or note** before acceptance (by design).

| Error | SQL state | When |
|---|---|---|
| `NOT_ALLOWED` | 42501 | caller is not an active driver |

### 3.2 `accept_order(p_order_id uuid)` → `orders` row

First driver wins (atomic `update ... where driver_id is null`). Sets `driver_id = me`,
`assigned_at = now()`, records history note `driver_accepted`. Status does **not** change.
After success the driver can read the full order (section 4).

| Error | SQL state | When |
|---|---|---|
| `NOT_ALLOWED` | 42501 | caller is not an active driver |
| `ORDER_NOT_AVAILABLE` | P0001 | already taken by another driver, cancelled, delivered, out for delivery, or not found. Show "taken by another driver" and refresh the list |

### 3.3 `set_order_status(p_order_id uuid, p_status order_status, p_reason text default null)` → `orders` row

The only way to change status. A driver may do exactly two transitions, and only on orders
assigned to them:

| From | To | Meaning |
|---|---|---|
| `preparing` | `out_for_delivery` | picked up, on the way |
| `out_for_delivery` | `delivered` | delivered and cash collected (confirm twice in the UI) |

Checks run in this order; the first failure is returned:

| Error | SQL state | When |
|---|---|---|
| `NOT_AUTHENTICATED` | 28000 | no session, or profile missing / inactive |
| `ORDER_NOT_FOUND` | P0001 | no such order |
| `INVALID_TRANSITION` | P0001 | not a valid transition from the current status; `details` = `"<from> -> <to>"` (e.g. trying `out_for_delivery` while still `pending`, or acting on a `cancelled` order) |
| `NOT_ALLOWED` | 42501 | valid transition but not allowed for a driver: not your order (e.g. reassigned), or a target other than the two above (drivers **cannot cancel**) |
| `NO_DRIVER_ASSIGNED` | P0001 | not reachable for drivers (kept for completeness) |

Side effects: timestamps (`out_for_delivery_at`, `delivered_at`), a history row, a push to the
customer, and on `delivered` the daily reports are updated.

### 3.4 `register_push_token(p_token text, p_platform push_platform)` → void

`p_platform` is `'ios'` or `'android'`. Call after sign-in, after the token changes, and on app start.
If the same token was registered by another account (shared device), it moves to the current user.
The driver can also `select`/`delete` their own rows in `push_tokens` (e.g. delete on sign-out).

| Error | SQL state | When |
|---|---|---|
| `NOT_AUTHENTICATED` | 28000 | no session |
| `INVALID_TOKEN` | P0001 | empty/blank token, token longer than 255 characters, or missing platform |

See section 6 about the token format (open question).

### 3.5 Not for drivers

`place_order`, `rate_order` (customer); `assign_driver`, `adjust_stock`, `set_user_role` (staff/admin).
A driver calling them gets `NOT_CUSTOMER` / `NOT_ALLOWED` / `ORDER_NOT_RATEABLE`.

---

## 4) What a driver can read (RLS)

All writes go through the functions above; there are no insert/update/delete grants on orders.

| Table | Driver can read |
|---|---|
| `orders` | only rows where `driver_id = auth.uid()` **and** the account is an active driver (all columns, including `customer_name`, `customer_phone`, `address_snapshot`). **Not** unassigned orders (use `available_orders`), not other drivers' orders. Losing the assignment, deactivation, or a role change removes access immediately (also for `order_items`, `order_status_history` and Realtime events) |
| `order_items` | items of orders they can read |
| `order_status_history` | history of orders they can read |
| `profiles` | own row only |
| `push_tokens` | own rows (select, insert, update, delete) |
| `app_settings`, `cities`, `sectors`, `subsections`, `buildings`, active `categories` / `products` | public catalog data |
| `addresses`, `ratings`, `stock`, costs, `daily_stats`, `inventory_movements`, `notification_outbox` | **no access** |

`orders.address_snapshot` (jsonb, frozen at order time):
```json
{ "address_id": "uuid", "sector": "قطاع A", "subsection": "القسم 1", "building": "12",
  "apartment": "5", "note": "optional text or null" }
```

Useful queries:
```ts
// current orders (assigned to me, not final), oldest first
supabase.from('orders')
  .select('id, order_number, status, address_snapshot, customer_name, customer_phone, total_iqd, note, created_at')
  .eq('driver_id', uid).in('status', ['pending', 'preparing', 'out_for_delivery'])
  .order('created_at');

// order details with items
supabase.from('orders')
  .select('*, order_items(name_snapshot, unit_snapshot, qty, price_snapshot_iqd, line_total_iqd)')
  .eq('id', orderId).single();

// history: delivered by me, pages of 20
supabase.from('orders').select('id, order_number, total_iqd, delivered_at, address_snapshot')
  .eq('driver_id', uid).eq('status', 'delivered')
  .order('delivered_at', { ascending: false }).range(page * 20, page * 20 + 19);
```
"Today's summary" (count and cash collected) is computed in the app from delivered orders whose
`delivered_at` falls on today in `Asia/Baghdad`.

---

## 5) Realtime

`public.orders` is in the `supabase_realtime` publication and Realtime applies RLS. Subscribe to
**your assigned orders only**:

```ts
supabase.channel('driver-orders')
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'orders', filter: `driver_id=eq.${uid}` },
      (payload) => { /* update the list / open order */ })
  .subscribe();
```

Limits to design around:
- **New unassigned orders do not arrive over Realtime** (RLS hides them). Use the push
  "new order" (section 6), pull-to-refresh, and polling `available_orders` every 30 s while the
  screen is open.
- **Cancellation** (by the customer while `pending`, or by staff/admin) arrives as an UPDATE with
  status `cancelled`, and you also get a push (`type: cancelled`, section 6).
- **Reassignment away from you** does **not** arrive over Realtime (the row is no longer visible to
  you); you get a push (`type: unassigned`). Still re-fetch current orders on app resume, on reconnect,
  and periodically (e.g. 30 s), since pushes can be delayed or lost; treat an order that disappears or
  turns `cancelled` as removed.
- Unsubscribe on sign-out.

---

## 6) Push notifications

Functions write to `notification_outbox`; the Edge Function `push-dispatch` (task T07, **not built
yet**) sends them. Notifications a driver receives:

| Trigger | Audience | Title (Arabic) | `data` |
|---|---|---|---|
| a customer places an order | **all active drivers** | `طلب جديد #<number>` | `{ "order_id": "uuid", "type": "new_order" }` → open "available orders" |
| staff/admin assigns an order to you | that driver | `تم تعيين طلب لك #<number>` | `{ "order_id": "uuid", "type": "assigned" }` → open the order |
| staff/admin reassigns your order to another driver | the previous driver | `سُحب منك الطلب #<number>` | `{ "order_id": "uuid", "type": "unassigned" }` → remove it from current orders |
| an order assigned to you is cancelled | the assigned driver | `تم إلغاء الطلب #<number>` (body = reason if given) | `{ "order_id": "uuid", "type": "cancelled", "status": "cancelled" }` → remove it from current orders |

Planned delivery (T07): Expo Push API, batches ≤ 100, Android `channelId: "orders"` with high priority.
The app should create an Android notification channel with id **`orders`** (high importance, distinct
sound) and ask for notification permission right after sign-in. Tokens that come back
`DeviceNotRegistered` are deleted server-side.

> **Open question: token format.** `push-dispatch` is designed for **Expo push tokens**
> (`ExponentPushToken[...]`) registered via `register_push_token`. If the driver app is **not** built with
> Expo (or does not use `expo-notifications`), it will register raw FCM / APNs tokens, and
> `push-dispatch` must be extended to send via FCM / APNs directly (and possibly a token-type column).
> To be decided with the driver app developer before T07 is implemented.

---

## 7) Status flow

```
pending ──► preparing ──► out_for_delivery ──► delivered
   │            │                 │
   └────────────┴─────────────────┴──► cancelled
```

| Step | Who | How |
|---|---|---|
| order created (`pending`) | customer | `place_order`; push "new order" to all drivers |
| driver takes it (status unchanged) | driver | `accept_order` from `pending` or `preparing` |
| or assigned manually | staff/admin | `assign_driver`; push "assigned" to that driver |
| `pending → preparing` | staff/admin | driver sees status `pending` with the button disabled ("waiting for preparation") |
| `preparing → out_for_delivery` | **assigned driver** | `set_order_status` (requires a driver assigned) |
| `out_for_delivery → delivered` | **assigned driver** | `set_order_status`; collect `total_iqd` in cash |
| `→ cancelled` | customer (pending only), staff (before out_for_delivery), admin (any non-final) | drivers cannot cancel; "problem with order" = call the administration |

`delivered` and `cancelled` are final. The driver cannot change order items.

---

## 8) Other requirements

- **Account deletion** inside the app is required by Apple/Google. It will be provided by the Edge
  Function `delete-account` (task T08, not built yet; called with the user's JWT).
- No live GPS tracking in phase 1. No limit on how many orders a driver carries at once. No
  "available / unavailable" switch yet (every active driver gets every new-order push).
- Concurrency: the accept is a single conditional `update`, so of two drivers accepting the same order
  only one succeeds and the other gets `ORDER_NOT_AVAILABLE` (pgTAP covers the second accept).

## Open questions

1. Push tokens: Expo vs raw FCM/APNs (section 6).
2. Account deletion rules for a driver holding an unfinished order (T08).
