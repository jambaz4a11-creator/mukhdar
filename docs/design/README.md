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

# Design system: admin panel (لوحة الأدمن)

Source: the approved admin design (https://claude.ai/artifact/4EwW1uVwkn6sDzTSuGEsK5).
Behaviour lives in `docs/SPEC-admin.md`; this section only records the look and the display rules.

## Shared tokens
- Same font (**IBM Plex Sans Arabic**), colors (`primary` `#1F6B3A`, `background`, `star`...),
  radii and Latin digits as the customer app above. Status badges use `STATUS_COLORS` and
  `STATUS_LABELS` from `packages/shared`.
- RTL, with the **sidebar on the right**. Sidebar order: الرئيسية، الطلبات، المنتجات والمخزون،
  هدر اليوم، التقييمات، التقارير والأرباح، الإعدادات والموظفون. Staff see only the pages they may open.

## Screens
| Screen | Notes |
|---|---|
| Home (الرئيسية) | greeting + store-open pill, 8 KPI cards (sales, delivered, cancelled, net profit, today's orders, average order, waste, low stock) with change vs yesterday, open orders by status (4 tiles), low-stock list, today's orders table (SPEC-admin §2.0). Built in T25; deviations below |
| Orders (Main) | status tabs with counts, table, side panel with details, print (§2.1) |
| Products & stock | categories section (image cards: image, name, product count, edit; "+ قسم جديد"), products table with price and cost **per kilo**, stock in kilos, "(قليل)" under the threshold, "نفد" at 0, "غير محدد" for a missing cost (§2.2, §2.3) |
| Daily Waste (هدر اليوم) | read-only "today" label (Baghdad date, no date input), one quantity input per active product (kilos or bunch, unit label by the name), cost before saving, one save, last 7 days, link to the waste report (§2.3) |
| Ratings (التقييمات) | average, count, star distribution, filtered list (§2.8) |
| Ratings (التقييمات) | average + stars, count, distribution bars, filter chips, list of ratings with order link (SPEC-admin §2.8). Built in T26; deviations below |
| Reports (التقارير والأرباح) | range picker, cards, daily chart, waste and top products in kilos, CSV (§2.5). Chart: sales `chartSales` + net profit `primary`, zero baseline (net profit can be negative), legend, hover values and a daily table view. The design's light green `#A9CDB3` failed the chart-colour checks (lightness, chroma, contrast 1.7:1), so `chartSales` replaces it (T20) |
| Settings & staff | fee, minimum order, store open/closed, staff and drivers, PIN reset (§2.6, §2.7) |

## Admin-only tokens
- **`chartSales` = `#4CAF6A`** (`--color-chart-sales`): daily sales bars in the reports chart; net profit bars use `primary`. Validated with net profit as a two-series chart palette (lightness, chroma, CVD ΔE 20.9); contrast 2.7:1 is covered by the legend, hover values and the table view (T20).

## Display rules
- **Kilos inside the admin panel:** quantities and prices of half-kilo products are shown and
  entered per kilo (0.5 steps; price per kilo a multiple of 500). Bunch/piece products keep their
  unit. Conversion only through `packages/shared/src/adminUnits.ts` (SPEC-admin §2.9). The
  customer app keeps showing price per half kilo.
- Numbers are never truncated: cards grow or wrap, `tabular-nums`, no `overflow: hidden` or
  `text-overflow` on figures.
- Wide container up to 1600px on large screens; card grids use `auto-fit`.
- Category and product images are resized in the browser to WebP before upload; missing images
  show a neutral tile with the first letter.

## Home screen: deviations from the approved design (T25)
Design source: `project/Home.dc.html` of the approved admin canvas. Implemented as drawn (layout, order of the
8 cards, tags, colours, Iraqi wording such as "هسه" and "وي أمس", the 4 open-order tiles, the low-stock list).
Differences, all deliberate:
1. **Staff view.** The design tags cards "للأدمن" / "الكل" on one screen. Staff never get the admin cards at
   all (the database returns the money fields as `null`), so staff see 4 cards (delivered, cancelled, today's
   orders, low stock) and the orders table **without the total column**: the task rule is "no dinar figure on
   staff's home" (stricter than the receipt-money allowance for the orders page).
2. **Today's orders table** uses the shared `OrdersTable` (T17) with the `columns` prop to match the design's five
   columns (order, time, address, total, status) instead of the orders page's seven; first 50 only, with a link
   to the full list when there are more. Clicking a row opens it in the orders page (`/orders?order=<id>`).
3. **"Today's orders" card** shows the comparison vs yesterday at the same time (SPEC-admin §2.0 lists it for
   incoming orders) instead of the static caption "كل اللي انطلبت من الصبح".
4. **Average order** reads "عن أمس لنفس الساعة" (the design says only "عن أمس"): the comparison really is up to the
   same minute, so the wording says so.
5. **Greeting** follows the Baghdad hour ("صباح الخير" before 12:00, "مساء الخير" after) and the header has no
   "بيانات تجريبية" suffix (that was the mock-up's sample data). The store pill reads `app_settings.store_open`
   ("المحل مفتوح" / "المحل مسكّر").
6. **Low-stock list**: quantities via `formatAdminQuantity` (kilos for half-kilo products: "1.5 كيلو من حد 2.5 كيلو"),
   "نفد" at 0, first 8 by quantity, then "و N منتج آخر". The "منتجات ناقصة" card and "كل المخزون" link go to `/stock`
   (both roles may open it) rather than the design's products page.
7. **Realtime:** the existing orders subscription (250 ms debounce, `PanelProviders`) refreshes the page; the task
   file's separate 2 s debounce was not added (no new mechanism). Stock and the "same minute" window refresh by the
   same 60 s polling the settings page already uses.
8. **Stuck notifications** are not on the Home screen: neither the approved design nor SPEC-admin §2.0 has them
   (the admin-only indicator stays on the settings page).

## Ratings screen: deviations from the approved design (T26)
Design source: `project/Ratings.dc.html`. Implemented as drawn (average with stars, distribution bars with the
design's colours, filter chips, review cards with the star pill, order link and date, Iraqi wording).
1. **Date range.** SPEC-admin §2.8 and the task require a date range applied to the header and the list; the design has
   none. Added two native date inputs ("من" / "إلى") and a "كل المدة" reset next to the chips.
2. **Extra chip "نجمة ونجمتان"** (1-2 stars) next to the design's "3 وأقل", because the task's acceptance scenario filters
   1-2 stars. The design's chips and order are unchanged.
3. **Filters change the header too.** The chips and the range apply to the average, count and distribution as well as the
   list (the task's rule). All of it is computed by `ratings_summary` / `ratings_list`, never in the browser.
4. **Date text.** "اليوم 10:20 ص" / "أمس" / "13 تشرين الثاني" (Baghdad day, Latin digits; the year is added for another
   year). The header drops the mock-up's "بيانات تجريبية" suffix.
5. **Stars in the header:** the whole part of the average is filled (4.6 → 4 full + 1 pale), as drawn.
6. **Paging.** "عرض المزيد" button for the keyset pages of 50 (the design shows 5 sample cards).
7. **No moderation.** The design has no hide/delete for ratings or comments, so none was built, and there is nothing
   to audit in `admin_audit`. Comments are plain text everywhere (escaped by React; stored trimmed, control characters
   removed, at most 500 characters).
8. **Customer app:** the rating screen (T14) is unchanged; it now shows "التعليق أطول من 500 حرف" if the server rejects a
   comment (`COMMENT_TOO_LONG`).

