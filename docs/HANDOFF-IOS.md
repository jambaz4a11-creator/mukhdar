# Handoff: customer iOS app (سوق بسماوي)

For the outside iOS developer who will review the code, fix issues and ship the **customer** app to the App Store.
Written 2026-11-24. Most project docs are in Arabic; this file is the English entry point.

## 1. What this project is

A fruit & vegetable delivery app for Bismayah New City (Baghdad). Arabic UI, right-to-left. Cash on delivery.

| Part | Path | Stack |
|---|---|---|
| Customer app (**your scope**) | `apps/customer` | React Native + Expo SDK 58, TypeScript, Expo Router. Also exported as a PWA. |
| Driver app | `apps/driver` | Expo (Android APK + PWA). Not in your scope. |
| Admin / staff dashboard | `apps/admin` | Next.js on Cloudflare Workers. |
| Shared code | `packages/shared` | `formatAddress`, `formatQuantity`, prices, validation. Used by all apps. |
| Backend | `supabase/` | Postgres + RLS (`migrations/`), Edge Functions (`functions/`), pgTAP tests (`tests/`). |
| Scripts | `scripts/` | Seeding, Supabase CLI wrapper (`pnpm sb`), checks. |
| Brand assets | `branding/` | Logo source + `pnpm brand:icons` (regenerates every icon and the intro images). |
| Docs | `docs/` | SPECs, RUNBOOK, tasks, reviews, ADRs. |

Customer app layout (`apps/customer/src`): `app/` = routes (tabs: home, cart, orders, account; plus auth, address, checkout, order, product), `features/` = logic per domain (auth, cart, checkout, orders, notifications, ...), `components/`, `i18n/ar.ts` (all strings), `theme.ts`, `lib/`.

Key product rules (all enforced in the database, not in the app):
- Login = phone number + 6-digit PIN (it is the Supabase password). **No SMS, no OTP, ever.** Forgot PIN = WhatsApp the shop, the admin resets it. See `docs/ADR/0001-phone-pin-auth.md`.
- Prices are computed in the database (`place_order`); the app is never trusted with a price.
- Address = block → building → floor → apartment, chosen from lists. Displayed only via `formatAddress`.
- Order status flow: pending → preparing → ready → out_for_delivery → delivered (or cancelled).

## 2. Read these first

1. `CLAUDE.md` (Arabic): the working rules and the fixed business rules. Section 4 below sums up the workflow part.
2. `README.md`, then `docs/ARCHITECTURE.md`.
3. `docs/SPEC-customer.md` (your app) and `docs/SPEC-backend.md` (data model, RPCs, RLS).
4. `docs/RUNBOOK.md`: §13 (customer app), §16e (EAS/push pattern used for the driver app), §17 (production launch order), §18 (public repo rules).
5. `docs/tasks/00-README.md` (task status table) and `docs/tasks/24-release.md` (launch checklist).
6. `docs/PREVIEW.md`: the live preview links and demo phone numbers.

## 3. Run the customer app locally

Requirements: Node 24 (`.nvmrc`), pnpm 12.18.0 (`corepack enable`), Expo Go (SDK 58) on a phone, or a simulator.

```bash
pnpm install
cp apps/customer/.env.example apps/customer/.env   # then fill in the values from section 6
pnpm --filter @mukhdar/customer start              # scan the QR code with Expo Go
# different network / firewall: pnpm --filter @mukhdar/customer start -- --tunnel
# after editing .env: add -- --clear
```

- The first launch in Expo Go may reload once to switch to RTL. That is expected.
- Remote push does **not** work in Expo Go: you need a development build (`eas build --profile development`).
- Demo customer: `07000000101`. The PIN is sent privately by the owner (never written in the repo). You can also sign up a new account from the app and delete it from Account → Delete account.

Checks (run them before every PR, CI runs the same):

```bash
pnpm --filter @mukhdar/customer test        # jest-expo + React Native Testing Library
pnpm --filter @mukhdar/customer typecheck
pnpm lint                                   # eslint + prettier for the whole repo
```

The Playwright e2e in `apps/customer/e2e` writes to mukhdar-dev and needs the owner's service key; you do not need it. CI runs its own e2e against a local Supabase.

## 4. Workflow rules (mandatory)

- **Feature branch + pull request for every change.** No direct pushes to `main`: it is protected, and Cloudflare auto-deploys `main` to the customer preview, so it must always be deployable.
- **Merge only when all CI checks are green.**
- Small commits with clear messages. One task at a time.
- **Never commit secrets. The repo is public.** `.env*` (except `.env.example`), `google-services.json`, signing keys, `.p8`/`.p12` files and Apple credentials stay out of git. Only `EXPO_PUBLIC_*` values are public, because they ship inside the app.
- **Do not change Supabase (migrations, Edge Functions, auth settings, secrets), Cloudflare, or GitHub secrets/settings without asking the owner first.** If a fix needs a backend change, open an issue or PR and describe it; the owner applies it. Migrations are only ever applied with `pnpm sb db push` (see CLAUDE.md), never from a dashboard or MCP tool.
- Never use the Supabase `service_role` key in the app.
- If you change a product decision, update the matching SPEC in the same PR.

## 5. Build for iOS with EAS

### App identity

| Field | Value |
|---|---|
| App name | `سوق بسماوي` (already in `apps/customer/app.config.ts`) |
| Bundle ID | `com.mukhdar.customer` (already in `app.config.ts`; Android package is the same) |
| Expo slug / scheme | `mukhdar` / `mukhdar` |
| Version | `1.0.0`; build numbers come from EAS (`appVersionSource: remote`, `autoIncrement` on production) |

**Before registering the bundle ID:** the launch checklist (`docs/tasks/24-release.md`) requires every store account to be in the owner's name. Confirm with the owner which Apple Developer team the app lives in before you create the App ID or the App Store Connect record. A bundle ID belongs to the first team that claims it and is hard to move later.

### EAS project (under your own Expo account)

```bash
npm i -g eas-cli
eas login                         # your Expo account
cd apps/customer
eas init                          # creates the "mukhdar" project under your account
```

`app.config.ts` is dynamic, so `eas init` cannot write the project ID into it. Instead the config reads it from the `EAS_PROJECT_ID` variable (the project ID is not a secret):
- locally: put it in `apps/customer/.env`;
- for cloud builds: `eas env:create --name EAS_PROJECT_ID --value <id> --environment preview` (and `production`, `development`).

Add the section 6 values the same way (`eas env:create`, visibility "plaintext" is fine because they are public). `apps/customer/.env` does **not** reach cloud builds.

### Fix `eas.json` first (your first PR)

`apps/customer/eas.json` is missing two things. Copy the pattern from `apps/driver/eas.json`:
1. Each profile must name its EAS environment (`"environment": "development" | "preview" | "production"`), otherwise the variables above do not reach the build (lesson from review R2 M1 on the driver app).
2. A store-signed profile for TestFlight that still points at mukhdar-dev. The `production` profile sets `APP_ENV=production`, and `app.config.ts` **refuses to build** a production app that points at the dev project (safety guard, T23 L8). Suggested profile:

```json
"testflight": {
  "distribution": "store",
  "autoIncrement": true,
  "environment": "preview",
  "env": { "APP_ENV": "preview" }
}
```

Then: `eas build -p ios --profile testflight` and `eas submit -p ios --latest`.

Consider also adding `ios.config.usesNonExemptEncryption: false` (the app only uses HTTPS) to skip the export-compliance question on each upload.

### iOS push notifications (APNs)

- The app gets an **Expo push token** (`apps/customer/src/features/notifications/push.ts`, needs `EAS_PROJECT_ID`) and stores it in Supabase. The backend Edge Function `push-dispatch` sends through Expo's push service.
- APNs: let EAS create and store the key: `eas credentials -p ios` → Push Notifications → set up a new key (or accept the prompt during the first `eas build`). Needs the Apple Developer account.
- **Do not turn on "Enhanced Push Security"** on your Expo project. If it is on, the server needs an `EXPO_ACCESS_TOKEN` secret in Supabase, which only the owner can set. Ask first if you think it is needed.
- Test push on a development or TestFlight build on a real iPhone (push does not work in the simulator or Expo Go).

## 6. Public config values for mukhdar-dev (current target)

These are public: they are already inside the deployed web bundle at `https://mukhdar-app.pages.dev` and in `docs/RUNBOOK.md`.

```
EXPO_PUBLIC_SUPABASE_URL=https://ghcohlrzvehtcettaaiu.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_Aw0gaOTSoEYacyvoRCNzsA_DJJYAXU2
EXPO_PUBLIC_PRIVACY_URL=https://mukhdar-admin.jambaz4a11.workers.dev/privacy
EXPO_PUBLIC_TERMS_URL=https://mukhdar-admin.jambaz4a11.workers.dev/terms
EXPO_PUBLIC_SENTRY_DSN=            # leave empty (Sentry off)
EXPO_PUBLIC_SHOP_WHATSAPP=         # ask the owner (empty = "forgot PIN" WhatsApp link hidden)
EXPO_PUBLIC_SHOP_PHONE=            # ask the owner (empty = "call the shop" button hidden)
EAS_PROJECT_ID=                    # your EAS project ID
```

The publishable key is designed to be public; all access control is in RLS. Never put an `sb_secret_...` or `service_role` key anywhere in the app (the app refuses it).

## 7. Dev now, production at launch

- Every build today points at **mukhdar-dev** (test data, can be reset any time).
- The production Supabase project does not exist yet. At launch the owner creates it (`docs/RUNBOOK.md` §17, `docs/tasks/24-release.md`) and gives you its URL and publishable key. You then set them in the EAS `production` environment and **rebuild** with the `production` profile. A dev build must never be submitted for App Store review (the guard in `app.config.ts` blocks the obvious mistake).
- **Order: TestFlight first** (against dev, now) → **App Store only after production is live** and a real order has passed end to end on an iPhone.

App Store requirements already covered in the app: privacy policy link (Account screen, from `EXPO_PUBLIC_PRIVACY_URL`), in-app account deletion (Account → Delete account). Still needed at launch: a reviewer demo account on production (fixed phone + PIN, `customer` role only, written in the review notes), screenshots, Arabic description, App Privacy answers.

## 8. Known open items

- **T33 (driver app):** the Android APK is built; manual testing on two real devices and its report are still pending. It does not block the customer iOS work.
- **Production launch (T24):** production Supabase project, auth settings, first admin, reviewer account, EAS production builds for iOS and Android, TestFlight / Play internal testing for a week, store listings. All owner-approved steps.
- `eas.json` for the customer app: missing `environment` keys and a TestFlight profile (section 5).
- Shop phone and WhatsApp values are not set for app builds yet (ask the owner).
- `docs/OPEN-QUESTIONS.md` lists remaining product questions.

## 9. Contact

Questions, backend changes, secrets, accounts, anything touching Supabase/Cloudflare/GitHub settings: ask the owner (via the GitHub PR or issue, or directly).
