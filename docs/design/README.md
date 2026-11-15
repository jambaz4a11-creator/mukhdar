# Design system: customer app (المخضر)

Source: the approved design canvas (https://claude.ai/artifact/5fkNRTYcTeWSs77sb4S79z).
This file is the reference for code. The only implementation of these tokens is
`apps/customer/src/theme.ts`; screens import from there and never hard-code colors or sizes.
If the design changes, update this file and the theme file in the same commit.

## Language and direction
- Arabic UI, **RTL everywhere** (forced at app start; see SPEC-customer).
- **Latin digits** (0-9) for prices, quantities, order numbers, phone numbers and dates
  (for example `2,500 د.ع`, `#1042`, `07701234567`). Never Arabic-Indic digits.

## Typography
Font: **IBM Plex Sans Arabic** in four weights. It covers both Arabic and Latin glyphs.

| Weight | Token | Use |
|---|---|---|
| 400 | `regular` | body text, descriptions |
| 500 | `medium` | labels, secondary buttons, tab labels |
| 600 | `semibold` | card titles, prices, section headers |
| 700 | `bold` | screen titles, totals, primary buttons |

## Colors

| Token | Hex | Use |
|---|---|---|
| `primary` | `#1F6B3A` | primary buttons, active tab, links, selected state |
| `primaryPressed` | `#174F2B` | pressed state of primary |
| `primarySoft` | `#E8F2EA` | selected chip background, soft highlights |
| `background` | `#F7F8F3` | screen background |
| `surface` | `#FFFFFF` | cards, sheets, inputs, tab bar |
| `border` | `#E3E7DE` | card and input borders |
| `divider` | `#EEF0EB` | list separators |
| `text` | `#1B1F1A` | main text |
| `textMuted` | `#5B6458` | secondary text, captions, inactive tab |
| `danger` | `#A1332A` | errors, destructive actions |
| `dangerSoft` | `#FCEDEB` | error banner background |
| `warningText` | `#7A4A00` | warnings (store closed, minimum order) |
| `warningSoft` | `#FFF1DC` | warning banner background |
| `star` | `#E8A13A` | rating stars |

**Order status badges** use `STATUS_COLORS` and `STATUS_LABELS` from `packages/shared`
(`status.ts`), not this table, so the admin panel and the app always agree.

## Shape and spacing
- Radius: **12** small controls (steppers, small buttons), **14** inputs, **16** cards and main
  buttons, **full** (pill) for chips and badges.
- Spacing: screen padding **20**; gaps **8 / 10 / 12 / 16**.

## Sizes
- Touch targets at least **44 × 44**.
- Primary button height **56**.
- Bottom tab bar height **72**, with **4 tabs** (right to left): Home (الرئيسية), Cart (السلة),
  Orders (طلباتي), Account (حسابي).

## Screens
| Screen | Notes |
|---|---|
| Home | categories, products, store-closed banner from `app_settings` |
| Product | large image, price per sale unit, quantity stepper (`formatQuantity`) |
| Cart | lines with stepper, minimum-order warning, total |
| Checkout | address, note, cash on delivery, confirm (56 high primary button) |
| Order tracking | 5-step timeline: تم استلام الطلب ← قيد التحضير ← جاهز، بانتظار السائق ← بالطريق ← تم التوصيل (or cancelled) |
| Orders | list with status badges |
| Rate | 1-5 stars (`star` color) and optional comment |
| Account | name, phone, addresses, privacy policy, sign out, delete account |
| Login | phone number (07XXXXXXXXX) + 6-digit PIN; sign-in / new-account modes, "forgot PIN?" opens WhatsApp |
| ~~OTP~~ | not built: no SMS/OTP (ADR 0001, 2026-11-14) |
| Name | full name on first sign-in |
| Address | sector A/B → unit (A1..A9 / B1..B8) → building number 1-100 (typed, checked against active buildings) → apartment; optional label (home/work), note, default. Home shows "delivery to" (`formatAddressShort`) |

Product images are **placeholders** until real photos exist (a neutral tile on `primarySoft`
with the product's first letter or a generic produce icon).
