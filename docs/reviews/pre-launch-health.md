# Pre-launch health check (2026-11-23)

Scope: dependency audit, bundle sizes, Lighthouse (mobile) on the customer and driver PWAs, Arabic/RTL. Measured on
`main` at `4b118e0` (+ the small fixes in this PR). Nothing was deployed or changed in the cloud. Findings are ordered
by severity; the last section lists what this PR fixed and what is left as follow-up.

## Summary

| Area | Result |
|---|---|
| `pnpm audit --prod` | 2 moderate, both in build-time tooling; nothing reaches a shipped runtime bundle |
| Admin worker vs Cloudflare limit | 1.64 MiB gzip (Workers limit: 3 MiB Free, 10 MiB Paid): **OK**, 55% of the Free limit |
| Customer web JS | 3.4 MB raw / 876 KB gzip; Lighthouse performance 50 (simulated slow 4G, uncompressed local server) |
| Driver web JS | 1.9 MB raw / 499 KB gzip; Lighthouse performance 55; a 1.28 MB icon font for one icon |
| Accessibility | customer 95 → **100** (fixed), driver 100 |
| Arabic / RTL | no English strings in the UI, no horizontal overflow at 320/360 px, `dir=rtl lang=ar` on both |

## Findings by severity

### Medium

**M1. Driver PWA downloaded a 1.28 MB icon font for a single icon (FIXED, 2026-11-23).** `apps/driver/src/components/AuthLayout.tsx`
imports `MaterialCommunityIcons` only for `truck-outline`; the whole `MaterialCommunityIcons.ttf` (1,307,660 bytes,
about 30% of the driver's first-load weight) is fetched on the login page. Ionicons (390 KB) is already loaded anyway.
Fixed: the login header icon is now Ionicons `car-outline` (Ionicons has no truck glyph; this is the closest) and
the `MaterialCommunityIcons` font is gone from `apps/driver/dist` (0 files, was 1,307,660 bytes). Re-measured with
Lighthouse mobile on the rebuilt driver: performance 53 (was 55, within run-to-run noise: the score is dominated by JS
execution under simulated throttling, not by this font, which only loads on demand), accessibility 100, best-practices
100, SEO 63 (expected: `robots.txt` is `Disallow: /` on purpose), total transfer 2,905 KiB uncompressed.

**M2. Customer first load is heavy.** `__common` is 2.2 MB raw (545 KB gzip) plus `entry` 1.1 MB (288 KB gzip), four
IBM Plex Sans Arabic weights (about 0.9 MB of TTF) and the Ionicons font (381 KB). Lighthouse (mobile, simulated 4G):
FCP 6.3 s, LCP 28 s, TTI 28 s, "unused JavaScript" about 1.7 MB. Caveats: my local server does not compress (Cloudflare
serves gzip/brotli, so real transfer is about a third), and the LCP is partly a product photo from Supabase Storage
(dev project, Singapore). Real numbers need a run against the deployed preview URL on a real phone. Candidate work:
subset the Arabic fonts (only the used weights/glyphs), `font-display: swap`, route-level code splitting of the
checkout/orders screens, check what makes `__common` 2.2 MB (Sentry, Supabase client, react-query, icon sets).
Follow-up, needs its own task.

### Low

**L1. `pnpm audit --prod`: 2 moderate advisories, both build-time only.**
- `glob` 9.0.0–14.0.1 (GHSA-3g3m-2fjr-6pw4, AbortSignal bypass): path
  `@sentry/react-native > @sentry/bundler-plugins > glob`. A bundler plugin used at build/upload time.
- `minimatch` 7.0.0–11.0.0 (GHSA-g3hv-75wg-m249, ReDoS via globparts): 79 paths, all through Expo/React Native
  tooling (`@expo/fingerprint`, metro, bundler plugins), run on developer/CI machines on trusted globs.
Neither package is bundled into the customer/driver web builds or the admin worker, and none processes untrusted
input. Fix when upstream bumps (or add a `pnpm.overrides` entry after checking Expo SDK 58 compatibility). No action
needed before launch.

**L2. No `robots.txt` (fixed).** The static host fell back to `index.html` for `/robots.txt`, which Lighthouse reports
as "robots.txt is not valid (49 errors)". Added `apps/customer/public/robots.txt` (allow all) and
`apps/driver/public/robots.txt` (`Disallow: /`: the drivers app is private). Customer SEO 83 → 100. The driver's SEO
score now reads 63 because the page is intentionally not crawlable; that is the intended result, not a defect.

**L3. Decorative product photos had no `alt` (fixed).** 16 `<img>` on the customer home page failed Lighthouse
`image-alt`. The name and price are text next to the photo, and the wrapper carries the accessible label when needed,
so the photo is decorative. expo-image writes `<img alt>` from `accessibilityLabel`, so `ProductImage` now passes
`accessibilityLabel=""` to the inner image (empty alt = decorative). Customer accessibility 95 → 100. (`alt=""` is
ignored by expo-image on web; that was tried first and re-measured.)

**L4. Source maps are not shipped** (Lighthouse `valid-source-maps`). Intentional for production; note that Sentry
web errors will have minified stacks unless source maps are uploaded to Sentry (the `@sentry/react-native` plugin
can do that at build time). Decide before launch if web error stacks matter.

### Info

**I1. PWA.** Lighthouse 13 no longer has a PWA category, so this was checked by hand on both builds. Present:
web manifest (name, short_name, `lang=ar`, `dir=rtl`, `id`, `start_url`, `scope`, `display=standalone`,
theme/background colors, 192 and 512 icons plus a 512 maskable icon), `apple-touch-icon`, `viewport-fit=cover`,
`theme-color`, `apple-mobile-web-app-capable`, a service worker at `/sw.js` served `no-cache`, and strict security
headers (CSP with script hashes, `X-Frame-Options: DENY`, nosniff). Not verified here (needs a real device on the
deployed HTTPS URL): the Android install prompt, iOS "Add to Home Screen" behaviour and offline start.

**I2. Admin worker size.** From a Linux CI build (`wrangler deploy --dry-run`, no deploy): Total Upload 8,228 KiB,
gzip 1,679.91 KiB, 57 static asset files. The Workers script limit is 3 MiB compressed on the Free plan and 10 MiB on
Paid, so there is room. The build could not be measured on this Windows machine (OpenNext fails reading pnpm symlinks
with "Access is denied", and runs out of memory under the default heap); CI builds it on Linux and passes. Worth
adding the dry-run size line to CI later so growth is visible.

**I3. Arabic / RTL checks done.**
- Static scan of JSX text, label-like props, `Alert` calls and the i18n catalogs: no English UI strings. Latin
  appears only as proper names inside Arabic sentences (iPhone, Safari, iOS, Sentry, Supabase/.env in
  developer-facing setup messages) and the `07XXXXXXXXX` phone placeholder in the admin. The "Sentry test error"
  button is `__DEV__` only.
- Rendered at 320 and 360 px (Playwright/Chromium, `ar-IQ`): no horizontal page scroll, no clipped or ellipsized
  text, `dir=rtl` and `lang=ar` on both apps. The only element beyond the viewport edge is the category chip row on
  the customer home, a horizontal scroller by design.
- Screenshots of the customer home and driver registration: RTL alignment, chip order and the Latin `+964` prefix
  next to the phone field all render correctly.
- Not covered: signed-in screens (cart, orders, account, driver lists) need data and a session, so they were not
  rendered; the existing component tests cover their strings. A signed-in pass on a real device is still worth doing
  for mixed-direction text (phone numbers, amounts, `#order` numbers inside Arabic sentences).

## What this PR changed

- `apps/customer/public/robots.txt`, `apps/driver/public/robots.txt` (L2)
- `apps/customer/src/components/ProductImage.tsx`: decorative alt on the inner image (L3)
- This report. Customer tests: 287/287; the customer web export and secret scan pass.

## Follow-ups (not done)

1. ~~M1~~ done (driver login icon swapped to Ionicons, font removed).
2. M2: customer first-load plan (font subsetting, code splitting, find out why `__common` is 2.2 MB), then
   re-measure on the deployed URL with a real phone.
3. L1: bump or override `glob`/`minimatch` when Expo/Sentry release patched versions.
4. L4: decide on uploading web source maps to Sentry.
5. I2: print the worker size in CI.
6. I1/I3: on-device PWA install and signed-in RTL pass.

## Open question for the owner

- Shop phone / WhatsApp number: not added anywhere yet (the owner has not provided the numbers). Needed before launch for the forgot-PIN flow.
