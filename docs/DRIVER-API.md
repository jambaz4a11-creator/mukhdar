# DRIVER-API: integration guide for the external driver app

The driver app is **built by a separate developer** and connects to this project's Supabase backend.
This document is the integration contract. It is self-contained: you should not need to read the rest
of the repo. Expected screens and UX are described in [SPEC-driver.md](SPEC-driver.md) (Arabic).

Source of truth for everything below: `supabase/migrations/` (functions `available_orders`,
`accept_order`, `set_order_status`, `register_push_token`, and the RLS policies). The behaviour is
covered by the pgTAP tests in `supabase/tests/` (`04_status_transitions.sql`, `05_driver.sql`,
`08_roles.sql`, `20_account_lifecycle.sql`). If the code and this document disagree, the code wins and this document is a bug.

> Changes to this contract (function signatures, error codes, policies, push payloads) must be agreed
> with the driver app developer first and land as a **new** migration.

---

## Changes for the driver app (2026-11-16)

Short version to send to the driver-app developer. Backend migrations `20261123000001` and
`20261125000001` (both applied to the development project). Details are in the sections linked below.
Migration `20261124000001` (review session B: stuck-notification counters, building numbers 1..100,
rate-limit table) has **no driver-facing change**.
Migration `20261126000001` (T20 reports) has **no driver-facing change** either: the `report_*` functions are admin-only
(drivers get `NOT_ALLOWED`), and `order_items.product_id` / `inventory_movements.product_id` became `on delete restrict`
(not visible to drivers).
Migrations `20261127000001` (admin Home dashboard) and `20261128000001` (ratings: stricter `rate_order`,
`ratings_summary` / `ratings_list`, stuck-notification count) also have **no driver-facing change**: ratings are not linked
to drivers (`ratings` has no `driver_id`), drivers still have no access to `ratings` (§ table below), and the new functions are
staff/admin only (drivers get `NOT_ALLOWED`). Migration `20261129000001` (ratings privacy: comment sanitizing, deleted-customer
name, one index dropped) is likewise not driver-facing.

1. **Admin-created driver accounts (§2).** Besides self sign-up (`signup` + admin promotion), the
   admin can now create a driver account directly from the panel with a **temporary PIN**, sent to
   the driver over WhatsApp. The driver signs in normally with phone + that PIN.
2. **Forced PIN change on first sign-in (§2).** Accounts created by the admin, and any account whose
   PIN the admin resets, have `profiles.must_change_pin = true`. While it is true, **every driver
   function refuses** (`available_orders` / `accept_order` → `NOT_ALLOWED`, `set_order_status` →
   `NOT_AUTHENTICATED`) and the driver reads no orders. Read the flag right after sign-in; if true,
   show a "choose a new PIN" screen (no way around it, plus Sign out):
   `signInWithPassword` with the temporary PIN → `updateUser({ password: newPin })` →
   `signOut({ scope: 'others' })`. The server clears the flag by itself when the password really
   changes; re-read the profile and continue. Reject a new PIN equal to the temporary one.
3. **PIN reset signs the driver out (§2).** When the admin resets a driver's PIN, all their sessions
   are revoked: the next token refresh fails (HTTP 400). Sign out locally and show the sign-in
   screen. The old access token keeps working for at most 1 hour, but the server already refuses
   driver functions while the flag above is set.
4. **Deactivated or demoted driver (§2).** **Deactivation and a role _downgrade_** (driver →
   customer) by the admin **revoke all sessions** (same handling as 3). A _promotion_ (driver →
   staff/admin) does **not** revoke sessions, but the account is no longer a driver, so driver
   functions refuse it. Before the refresh fails, driver functions return `NOT_ALLOWED` /
   `NOT_AUTHENTICATED` and order reads return nothing: re-read the profile and show "account not
   active". The admin **cannot** deactivate or demote a driver who still holds an order in
   `preparing`/`ready`/`out_for_delivery`; such orders are moved to another driver first.
5. **An order can be moved to another driver while `out_for_delivery` (§3.3, §5, §6, §7).**
   Staff/admin may now reassign an order that is already on the way (driver unreachable, vehicle broke
   down).
   - The previous driver gets the existing `unassigned` push and loses access to the order (it
     disappears from reads; no Realtime event).
   - The new driver gets the `assigned` push, titled `نُقل لك طلب بالطريق #<number>`, and the order is
     **already `out_for_delivery`**: show it in current orders with "Delivered" as the next step.
   - Assigning an order to the driver who already holds it does nothing (no push, no history row).
6. **`set_order_status` has a new optional 4th parameter `p_return_stock` (admin only, §3.3).**
   Drivers must not send it. Calls with three named arguments keep working unchanged.
7. **`order_status_history` has rows that are not status changes (§4).** Rows with
   `from_status = to_status` and `note` = `driver_assigned`, `driver_reassigned` or `driver_accepted`
   record who holds the order. A timeline must **not** render them as status changes (filter on
   `from_status <> to_status`, or show the note as its own event).
8. **Push notifications and the temporary PIN (migration `20261125000001`, §3.4, §6).**
   - **No push is sent to an account while `must_change_pin = true`** (a lost phone whose PIN the
     admin reset gets nothing, nor does anyone holding a temporary PIN they have not changed).
   - `register_push_token` **refuses** a flagged account with `PIN_CHANGE_REQUIRED` (SQLSTATE 42501).
     Do not register at sign-in while the flag is set; **register after the PIN change** (re-read the
     profile, flag false, then call it).
   - A PIN reset, a deactivation and a downgrade **delete the user's `push_tokens` rows**. After the
     driver signs in again (and has changed a temporary PIN), register the token again. Registering on
     every start (§3.4) already does this.
   - On sign-out, **delete this device's `push_tokens` row first, then `signOut()`**: after the
     session is revoked the app can no longer delete it.
9. **Assigning a driver who has not changed the temporary PIN is refused (§3.2).** `assign_driver`
   returns `DRIVER_PIN_PENDING`, so a new driver receives orders only after the first PIN change.
   `accept_order` re-checks role, active and flag under the driver's row lock: a driver demoted or
   deactivated at the same moment gets `NOT_ALLOWED`, never the order.

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

> **2026-11-17 (security review T23):** admin and staff accounts now need two-factor (TOTP) in the
> admin panel. **Drivers are not affected:** phone + PIN only, same calls, same RLS, no change in the
> driver app. Order caps added to `place_order` (customers only) do not touch driver functions.
>
> **2026-11-17 (T23 fix session E2):** still no driver-side change. Demo driver accounts `07000000011..13` on mukhdar-dev now have their **own dev-only PIN** (RUNBOOK §6); the shared `DEMO_PIN` stays admin/staff/customer-only and is never given to you. Panel idle timeout (12 h) applies to admin and staff sessions only, not drivers. Deleting a customer account anonymizes their old orders (name, phone, building, apartment removed): you may see `customer_name`/`customer_phone` null on a delivered order of a deleted customer; drivers only ever see those for orders they hold, which are never final.

1. **Phone number + 6-digit PIN** via Supabase Auth, same as the customer app (changed 2026-11-14:
   **no SMS/OTP at all**, nothing is ever sent). The PIN is the account password.
   **How a driver (or staff member) gets an account (changed 2026-11-15):** public sign-up in
   Supabase Auth is **turned off**, so `supabase.auth.signUp` and `signInWithOtp` cannot create
   accounts. New accounts are created only by our Edge Function `signup`; then sign in normally:
   ```ts
   // sign up (new account): no session is returned, sign in right after
   const { error } = await supabase.functions.invoke('signup', {
     body: { phone: '+9647XXXXXXXXX', pin: '482915' },   // any Iraqi format is accepted
   });
   // on error: const body = await error.context.json()  ->  { error: 'PHONE_TAKEN' | ... }
   // sign in (existing account)
   await supabase.auth.signInWithPassword({ phone: '+9647XXXXXXXXX', password: '482915' }); // E.164
   ```
   `signup` responses (no login needed; the call carries only the publishable key):

   | HTTP | Body | Meaning |
   |---|---|---|
   | 201 | `{ "created": true }` | account created (role `customer`): now call `signInWithPassword` |
   | 400 | `{ "error": "PHONE_INVALID" }` | not an Iraqi mobile number |
   | 400 | `{ "error": "PIN_INVALID" }` | PIN breaks the rules below (the server checks them too) |
   | 409 | `{ "error": "PHONE_TAKEN" }` | number already registered: switch to sign in |
   | 429 | `{ "error": "RATE_LIMITED" }` | too many sign-up attempts (per IP / per number, 1 hour) |
   | 400/405/500 | `{ "error": "SIGNUP_FAILED" }` | bad request or server error; try again |

   - Accept `07XXXXXXXXX` in the UI and convert to `+9647XXXXXXXXX`. Convert Arabic-Indic digits
     (`٠-٩`, `۰-۹`) to `0-9` in **both** the phone and the PIN before sending, or the same PIN typed on an
     Arabic keyboard will not match.
   - PIN rules for sign-up and PIN change (the app must check them before sending; `signup` checks
     them again on the server, a PIN change via `updateUser` is not checked by the server): exactly 6
     digits; reject all-same (`000000`), ascending/descending runs (`123456`, `987654`), repeats with
     period 2 or 3 (`121212`, `123123`), common PINs (`112233`, `159753`, `147258`...), and the first or
     last 6 digits of the user's own phone. Reference implementation: `validatePin` / `normalizePin` /
     `phonePinCredentials` in `packages/shared/src/pin.ts` of this repo (we can share the file).
   - Sign-in errors: `invalid_credentials` (wrong phone or PIN, same message for both), HTTP 429
     (Supabase per-IP rate limit: "too many attempts, wait"). `signUp`, `signInWithOtp` and
     `verifyOtp` are **rejected by the server** (public sign-up is off and an Auth hook refuses every
     SMS); do not use them.
   - **Forgot PIN:** the driver messages the shop on WhatsApp from the registered number; an admin
     resets the PIN from the admin panel. Offer a "Forgot PIN?" link that opens WhatsApp.
   - Every account must have a valid Iraqi mobile number (one account per number); this is enforced by
     the database.
   - **Development project:** phone + PIN sign-in is enabled once the project owner applies the Auth
     settings (RUNBOOK §6). Demo driver accounts then sign in with `07000000011`, `07000000012`,
     `07000000013` and the **driver-demo PIN** we send you (separate from the admin demo PIN; RUNBOOK §6). Never use it in
     production.
2. When `signup` creates the account a trigger creates `profiles` with `role = 'customer'`. **A new
   account is not a driver.** The admin activates it from the admin panel
   (`set_user_role(user, 'driver', true)`). Staff accounts work the same way (sign up in the customer
   app, then the admin sets the role `staff`).
   **Or (2026-11-16) the admin creates the account** in the panel (Edge Function `admin-create-user`):
   it is a driver from the start, with a **temporary PIN** the admin sends over WhatsApp. The driver
   signs in with phone + that PIN and must change it first (point 3).
3. After sign-in (and on every app start / resume), read your own profile:
   ```ts
   const { data } = await supabase.from('profiles')
     .select('id, role, full_name, phone, is_active, must_change_pin').eq('id', user.id).single();
   ```
   - `must_change_pin === true` (temporary PIN from the admin: new account or PIN reset): show the
     **change PIN** screen first, with no way to skip it (only Sign out). Flow: `signInWithPassword`
     with the current (temporary) PIN → check the new PIN with the rules above and that it differs from
     the temporary one → `updateUser({ password: newPin })` → `signOut({ scope: 'others' })` → re-read
     the profile. **The server clears the flag itself** when the password really changes (a database
     trigger); there is no call to make. While the flag is set, every driver function refuses
     (`NOT_ALLOWED` / `NOT_AUTHENTICATED`) and order reads return nothing.
   - If `role !== 'driver'` or `is_active === false`, show "account not activated as a driver, contact
     the administration" with **Refresh** and **Sign out**. Do not call the driver functions.
4. A deactivated or demoted driver is rejected by every driver function (`NOT_ALLOWED` /
   `NOT_AUTHENTICATED`) even with a valid session, so handle those errors by re-checking the profile.
   **Since 2026-11-16 deactivation or a role _downgrade_ also revokes every session** (as does a PIN
   reset by the admin; a promotion to staff/admin does not): the next token refresh fails (HTTP 400). On a refresh failure, sign out locally and
   show the sign-in screen. The admin cannot deactivate or demote a driver who still holds an order in
   `preparing`/`ready`/`out_for_delivery` (the orders are moved to another driver first), so a driver
   never loses access in the middle of a delivery without first receiving the `unassigned` push.
5. The driver may update only `profiles.full_name` (`update ... set full_name`); role, phone and
   `is_active` are not writable.

---

## 3) RPC functions

Call with `supabase.rpc(name, params)`. Errors come back as a PostgREST error where
**`error.message` is the error code** below (e.g. `'ORDER_NOT_AVAILABLE'`), `error.code` is the SQL
state, and `error.details` carries extra info where noted. Match on `error.message`.

### 3.1 `available_orders(p_limit int default 20)` → `setof row`

Unassigned orders a driver can take: `driver_id is null` and status `ready` (prepared, waiting for a driver),
oldest first. `p_limit` is clamped to 1..50.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | |
| `order_number` | bigint | number shown to people |
| `status` | `'ready'` | always `ready` |
| `sector`, `subsection`, `building` | text | address without apartment: sector (`قطاع A`), unit (`A3`), building number (`12`) |
| `item_count` | bigint | sum of quantities, in sale units (a half kilo counts as 1) |
| `total_iqd` | bigint | amount to collect in cash |
| `created_at` | timestamptz | |

**No customer name, phone, apartment or note** before acceptance (by design).

| Error | SQL state | When |
|---|---|---|
| `NOT_ALLOWED` | 42501 | caller is not an active driver |

### 3.2 `accept_order(p_order_id uuid)` → `orders` row

Only unassigned orders in status `ready`. First driver wins (atomic `update ... where driver_id is null and status = 'ready'`). Sets `driver_id = me`,
`assigned_at = now()`, records history note `driver_accepted`. Status does **not** change.
After success the driver can read the full order (section 4).

| Error | SQL state | When |
|---|---|---|
| `NOT_ALLOWED` | 42501 | caller is not an active driver (role, active and `must_change_pin = false` are re-checked under the driver's row lock, so a driver demoted at the same instant is refused) |
| `ORDER_NOT_AVAILABLE` | P0001 | not `ready` (still `pending`/`preparing`, out for delivery, delivered, cancelled), already taken by another driver, or not found. Show "taken by another driver" and refresh the list |

### 3.3 `set_order_status(p_order_id uuid, p_status order_status, p_reason text default null, p_return_stock boolean default true)` → `orders` row

`p_return_stock` (2026-11-16) is for the admin panel only (cancel an order on the way without putting
the goods back in stock). **Drivers never send it**; calls with the three named arguments are unchanged.

The only way to change status. A driver may do exactly two transitions, and only on orders
assigned to them:

| From | To | Meaning |
|---|---|---|
| `ready` | `out_for_delivery` | picked up, on the way |
| `out_for_delivery` | `delivered` | delivered and cash collected (confirm twice in the UI) |

**Fallback (2026-11-16):** staff and admin may also make these two transitions from the admin panel
(`out_for_delivery` still requires an assigned driver) when the driver app is down or the driver
forgot to update. The driver app must therefore expect an assigned order to move to
`out_for_delivery` or `delivered` without its own action (it arrives as a normal Realtime UPDATE).

Checks run in this order; the first failure is returned:

| Error | SQL state | When |
|---|---|---|
| `NOT_AUTHENTICATED` | 28000 | no session, or profile missing / inactive |
| `ORDER_NOT_FOUND` | P0001 | no such order |
| `INVALID_TRANSITION` | P0001 | not a valid transition from the current status; `details` = `"<from> -> <to>"` (e.g. trying `out_for_delivery` while still `preparing`, or acting on a `cancelled` order) |
| `NOT_ALLOWED` | 42501 | valid transition but not allowed for a driver: not your order (e.g. reassigned), or a target other than the two above (drivers **cannot cancel**) |
| `NO_DRIVER_ASSIGNED` | P0001 | not reachable for drivers (kept for completeness) |

Side effects: timestamps (`out_for_delivery_at`, `delivered_at`), a history row, a push to the
customer, and on `delivered` the daily reports are updated.

### 3.4 `register_push_token(p_token text, p_platform push_platform, p_provider push_provider default 'expo')` → void

`p_platform` is `'ios'` or `'android'`. `p_provider` says which push service the token belongs to:
`'expo'` (default; an Expo push token `ExponentPushToken[...]` / `ExpoPushToken[...]` from
`expo-notifications`) or `'fcm'` (a raw FCM registration token; **reserved**, see section 6).
Call after sign-in, after the token changes, and on app start.
If the same token was registered by another account (shared device), it moves to the current user.
The driver can also `select`/`delete` their own rows in `push_tokens`: **delete this device's row before
`signOut()`**. The admin resetting the PIN, deactivating or downgrading the account deletes all of the
user's rows (register again after signing back in).

| Error | SQL state | When |
|---|---|---|
| `NOT_AUTHENTICATED` | 28000 | no session |
| `PIN_CHANGE_REQUIRED` | 42501 | the account still has `must_change_pin = true`: register after the PIN change (2026-11-16, session C) |
| `INVALID_TOKEN` | P0001 | empty/blank token, token longer than 255 characters, missing platform or provider, or an `expo` token not in the `ExponentPushToken[...]` / `ExpoPushToken[...]` format |

See section 6 for which providers are delivered today.

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
| `order_status_history` | history of orders they can read. Includes non-status rows (`from_status = to_status`, `note` = `driver_assigned` / `driver_reassigned` / `driver_accepted`): do not render them as status changes |
| `profiles` | own row only |
| `push_tokens` | own rows: select and delete only. Insert/update only through `register_push_token` (since 2026-11-14) |
| `app_settings`, `cities`, `sectors`, `subsections`, `buildings`, active `categories` / `products` | public catalog data |
| `addresses`, `ratings`, `stock`, costs, `daily_stats`, `inventory_movements`, `notification_outbox` | **no access** |

`orders.address_snapshot` (jsonb, frozen at order time):
```json
{ "address_id": "uuid", "sector": "قطاع A", "subsection": "A3", "building": "12",
  "apartment": "5", "note": "optional text or null" }
```

**Address layout (Bismayah):** two sectors, `قطاع A` and `قطاع B`. Sector A has units `A1`–`A9`, sector B
has units `B1`–`B8` (table `subsections`), and each unit has buildings `1`–`100` (table `buildings`).
**Building numbers repeat across units**, so always show the unit with the building. Arabic UI labels:
subsection = **"وحدة"**, building = **"عمارة"**, e.g. `قطاع A، وحدة A3، عمارة 12، شقة 5`. Push bodies
use the same wording (`وحدة A3 - عمارة 12`).

**Quantities and units:** `order_items.qty` is an integer count of the product's sale unit
(`unit_snapshot`). Produce is sold per **`نص كيلو`** (half kilo) at a fixed price per half kilo (no
weighing), herbs per `باقة`, and some items per piece (`حبة`, `علبة`, `قنينة`, `سلة`). Display rule
(same as `formatQuantity` in `packages/shared`): for `نص كيلو`, qty 1 → `نص كيلو`, 2 → `1 كيلو`,
3 → `1.5 كيلو`, n → `n/2 كيلو`; otherwise `n <unit>` (e.g. `3 باقة`).

Useful queries:
```ts
// current orders (assigned to me, not final), oldest first
supabase.from('orders')
  .select('id, order_number, status, address_snapshot, customer_name, customer_phone, total_iqd, note, created_at')
  .eq('driver_id', uid).in('status', ['preparing', 'ready', 'out_for_delivery'])
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
- **Reassignment away from you** (also possible while `out_for_delivery` since 2026-11-16) does **not** arrive over Realtime (the row is no longer visible to
  you); you get a push (`type: unassigned`). Still re-fetch current orders on app resume, on reconnect,
  and periodically (e.g. 30 s), since pushes can be delayed or lost; treat an order that disappears or
  turns `cancelled` as removed.
- Unsubscribe on sign-out.

---

## 6) Push notifications

Functions write to `notification_outbox`; the Edge Function `push-dispatch` (T07) sends them,
usually within a few seconds (a database trigger calls it on every insert; `pg_cron` retries every
minute). Nothing is sent to an account whose `must_change_pin` is true. Notifications a driver receives:

| Trigger | Audience | Title (Arabic) | `data` |
|---|---|---|---|
| staff/admin marks an unassigned order `ready` | **all active drivers** | `طلب جديد #<number>` (body: unit and building) | `{ "order_id": "uuid", "type": "new_order" }` → open "available orders" |
| staff/admin marks `ready` an order already assigned to you | that driver | `الطلب #<number> جاهز للاستلام` | `{ "order_id": "uuid", "type": "ready" }` → open the order |
| staff/admin assigns an order to you | that driver | `تم تعيين طلب لك #<number>`; if the order is already on the way (moved from another driver): `نُقل لك طلب بالطريق #<number>` | `{ "order_id": "uuid", "type": "assigned" }` → open the order (check its status) |
| staff/admin reassigns your order to another driver | the previous driver | `سُحب منك الطلب #<number>` | `{ "order_id": "uuid", "type": "unassigned" }` → remove it from current orders |
| an order assigned to you is cancelled | the assigned driver | `تم إلغاء الطلب #<number>` (body = reason if given) | `{ "order_id": "uuid", "type": "cancelled", "status": "cancelled" }` → remove it from current orders |

Delivery is chosen **per token** by its provider (`push_tokens.provider`, set by `register_push_token`):

| Provider | Status | Details |
|---|---|---|
| `expo` (default) | **implemented** | Expo Push API, batches ≤ 100, `priority: "high"`, `sound: "default"`, Android `channelId: "orders"` |
| `fcm` | **reserved, not implemented** | tokens are accepted and stored, but skipped when sending. The outbox row records `last_error = "fcm: N token(s) skipped (provider not implemented)"` (and, if the user has no other token, it is not retried) |

**Recommendation for the driver app:** use `expo-notifications` and register the Expo push token
(provider `expo`). If you build without Expo and need raw FCM / APNs, tell us first. The FCM sender
will be added to `push-dispatch` (a server change, no change to this API). APNs is not planned: on iOS use
Expo tokens.

The app should create an Android notification channel with id **`orders`** (high importance, distinct
sound) and ask for notification permission right after sign-in. Tokens that come back
`DeviceNotRegistered` are deleted server-side, so register again on every app start.
Delivery is best effort: Expo outages are retried (up to 5 attempts, about 5 minutes apart). A
notification that reached at least one of the user's devices is not re-sent.

---

## 7) Status flow

```
pending ──► preparing ──► ready ──► out_for_delivery ──► delivered
   │            │           │              │
   └────────────┴───────────┴──────────────┴──► cancelled
```

| Step | Who | How |
|---|---|---|
| order created (`pending`) | customer | `place_order`; push to admins/staff only (**drivers are not notified yet**) |
| `pending → preparing` | staff/admin | |
| `preparing → ready` | staff/admin | push "new order" to all active drivers (or "ready" to the pre-assigned driver) and to the customer |
| driver takes it (status unchanged) | driver | `accept_order`, only while `ready` and unassigned |
| or assigned manually | staff/admin | `assign_driver` from `preparing` or `ready`; push "assigned" to that driver. A pre-assigned `preparing` order shows the button disabled ("waiting for preparation") |
| moved to another driver while on the way (2026-11-16) | staff/admin | `assign_driver` on an `out_for_delivery` order: status stays `out_for_delivery`; the previous driver gets `unassigned` and loses the order, the new driver gets `assigned` (title `نُقل لك طلب بالطريق #<number>`) and continues with "delivered" |
| `ready → out_for_delivery` | **assigned driver** (fallback: staff/admin) | `set_order_status` (requires a driver assigned) |
| `out_for_delivery → delivered` | **assigned driver** (fallback: staff/admin) | `set_order_status`; collect `total_iqd` in cash |
| `→ cancelled` | customer (`pending` only), staff (`pending`/`preparing`/`ready`), admin (also `out_for_delivery`) | drivers cannot cancel; "problem with order" = call the administration |

`delivered` and `cancelled` are final. The driver cannot change order items.

---

## 8) Other requirements

- **Account deletion** inside the app is required by Apple/Google. Edge Function `delete-account` (T08):
  ```ts
  const { data, error } = await supabase.functions.invoke('delete-account', { method: 'POST' });
  // on error: const body = await error.context.json()  ->  { error: 'ACTIVE_ORDER' | ... }
  ```
  It uses the signed-in user's JWT (sent automatically by `functions.invoke`). Responses:

  | HTTP | Body | Meaning |
  |---|---|---|
  | 200 | `{ "deleted": true }` | account deleted; sign out locally and clear local data |
  | 401 | `{ "error": "NOT_AUTHENTICATED" }` (or a gateway 401) | no/expired session |
  | 409 | `{ "error": "ACTIVE_ORDER" }` | **a driver with an assigned order that is not delivered/cancelled cannot delete** (also a customer with an unfinished order). Finish or hand back the order first (call the administration) |
  | 403 | `{ "error": "ADMIN_ACCOUNT" }` | admin accounts are not deleted from an app |
  | 500 | `{ "error": "delete failed" }` | nothing was deleted; try again |

  After deletion: the profile, push tokens and addresses are removed; delivered orders stay (for
  accounting) with `driver_id = null`; the refresh token is revoked and the old access token is
  rejected. The same phone number can sign up again later as a new account.
- No live GPS tracking in phase 1. No limit on how many orders a driver carries at once. No
  "available / unavailable" switch yet (every active driver gets every new-order push).
- Concurrency: the accept is a single conditional `update`, so of two drivers accepting the same order
  only one succeeds and the other gets `ORDER_NOT_AVAILABLE` (pgTAP covers the second accept).

## Open questions

1. ~~Push tokens: Expo vs raw FCM/APNs~~ resolved in T07: a provider per token; `expo` is implemented
   and `fcm` is reserved (section 6). Tell us if the app needs `fcm`.
2. ~~Account deletion rules for a driver holding an unfinished order~~ resolved in T08: refused with
   `409 ACTIVE_ORDER` (section 8).
