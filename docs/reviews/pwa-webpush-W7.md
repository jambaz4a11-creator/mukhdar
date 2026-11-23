# W7 (T39): PWA and Web Push on a real device

- **Date:** 2026-11-23. **Tester:** the owner (manual).
- **Device:** iPhone 11, iOS 26.6. Both apps were the live PWAs, added to the home screen.
- **Environment:** mukhdar-dev backend, live Cloudflare Pages deployments.

## Results

| Area | Item | Result |
|---|---|---|
| Customer PWA | Sign-up | Passed |
| Customer PWA | Ordering | Passed |
| Customer PWA | Enable push after the first order | Passed |
| Customer PWA | Push received for order status changes, including on the lock screen | Passed |
| Customer PWA | Tapping a push opens the order | Passed |
| Driver PWA | Sign-in | Passed |
| Driver PWA | Push for new orders | Passed |
| Driver PWA | Order flow | Passed |
| Driver PWA | Cash handover (SPEC-cash §14 items 3 and 4, R4 manual check) | Passed |

## Not covered by this report

- Android Chrome was not tested.
- Per-state delivery latency and screenshots were not recorded.
- Task steps 5–7 (sign-out/offline token removal, uninstall/reinstall, RTL and safe-area check) were not reported
  separately; nothing was reported as failing.
- `docs/PREVIEW.md` was not changed.

## Effect on the plan

- T39 is marked done. R4's manual dev check is done on the driver PWA. The native APK check stays with T33.
