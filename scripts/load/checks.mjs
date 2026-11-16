// T22: فحوص الصحة بعد/أثناء الحمل. الأجزاء النقية مختبَرة بـ lib.test.mjs؛ فحوص SQL تعمل على mukhdar-dev.
// القاعدة: الصحة أهم من السرعة. أي فحص هنا يفشل = فشل مطلق (بغض النظر عن زمن الاستجابة).

/**
 * سباق على آخر رصيد منتج: requests = [{ qty, result }] حيث result = 'OK' أو رمز الخطأ.
 * الثوابت: الرصيد النهائي ≥ 0؛ = الابتدائي − مجموع الكميات الناجحة (لا بيع زائد ولا ضياع)؛
 * ولا رفض خاطئ: الرصيد يتناقص فقط بهذه المرحلة، فطلب كميته q رُفض بينما الرصيد النهائي ≥ q ← كان يجب أن ينجح.
 */
export function checkOversell({ initial, finalStock, requests }) {
  const errors = [];
  const sold = requests.filter((r) => r.result === 'OK').reduce((a, r) => a + r.qty, 0);
  for (const r of requests) {
    if (r.result !== 'OK' && r.result !== 'INSUFFICIENT_STOCK') {
      errors.push(`unexpected result ${r.result} (qty ${r.qty})`);
    }
  }
  if (sold > initial) errors.push(`oversold: sold ${sold} of ${initial}`);
  if (finalStock < 0) errors.push(`negative stock ${finalStock}`);
  if (finalStock !== initial - sold) {
    errors.push(`balance mismatch: final ${finalStock} != initial ${initial} - sold ${sold}`);
  }
  for (const r of requests) {
    if (r.result === 'INSUFFICIENT_STOCK' && finalStock >= r.qty) {
      errors.push(`wrongly refused: qty ${r.qty} refused but final stock is ${finalStock}`);
    }
  }
  return errors;
}

/** سباق قبول سائقين على طلب واحد: بالضبط OK واحد، والباقي ORDER_NOT_AVAILABLE. */
export function expectedRaceOutcome(results) {
  const errors = [];
  const ok = results.filter((r) => r === 'OK').length;
  if (ok !== 1) errors.push(`expected exactly 1 winner, got ${ok}`);
  for (const r of results) {
    if (r !== 'OK' && r !== 'ORDER_NOT_AVAILABLE') errors.push(`unexpected result ${r}`);
  }
  return errors;
}

// ---------------------------------------------------------------------
// فحوص SQL بعد التصريف (كل الطلبات نهائية). db = pg.Client بدور postgres.
// ---------------------------------------------------------------------

/**
 * @param {import('pg').Client} db
 * @param {{orderIds: string[], productIds: string[], day: string}} ctx
 * @returns {Promise<{name: string, ok: boolean, detail: string}[]>}
 */
export async function verifyDatabase(db, { orderIds, productIds }) {
  const out = [];
  const add = (name, bad, okDetail) =>
    out.push({
      name,
      ok: bad.length === 0,
      detail:
        bad.length === 0
          ? okDetail
          : `${bad.length} violation(s): ${JSON.stringify(bad.slice(0, 5))}`,
    });
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows);

  // 1) دفتر المخزون = الرصيد، ولا رصيد سالب (منتجات الحمل)
  add(
    'stock ledger equals balance, never negative (load products)',
    await q(
      `select p.id, s.qty, coalesce((select sum(m.qty) from public.inventory_movements m where m.product_id = p.id), 0)::int as ledger
         from public.products p join public.stock s on s.product_id = p.id
        where p.id = any ($1)
          and (s.qty < 0 or s.qty <> coalesce((select sum(m.qty) from public.inventory_movements m where m.product_id = p.id), 0))`,
      [productIds],
    ),
    `${productIds.length} products`,
  );

  // 2) حركات كل طلب تطابق بنوده: مبيع = -الكميات، والملغى صافيه صفر (cancel_return)
  add(
    'per-order movements match items (sale = -qty; cancelled nets to 0)',
    await q(
      `select o.id, o.status,
              coalesce((select sum(m.qty) from public.inventory_movements m where m.order_id = o.id), 0)::int as moved,
              coalesce((select sum(i.qty) from public.order_items i where i.order_id = o.id), 0)::int as items
         from public.orders o
        where o.id = any ($1)
          and coalesce((select sum(m.qty) from public.inventory_movements m where m.order_id = o.id), 0)
              <> case when o.status = 'cancelled' then 0
                      else -coalesce((select sum(i.qty) from public.order_items i where i.order_id = o.id), 0) end`,
      [orderIds],
    ),
    `${orderIds.length} orders`,
  );

  // 3) كل طلب بالطريق/مسلّم له سائق واحد بالضبط، وقبول واحد على الأكثر بالتاريخ
  add(
    'each order has exactly one driver once out_for_delivery/delivered',
    await q(
      `select o.id, o.status, o.driver_id from public.orders o
        where o.id = any ($1) and o.status in ('out_for_delivery', 'delivered') and o.driver_id is null`,
      [orderIds],
    ),
    'driver_id set on every dispatched order',
  );
  add(
    'at most one driver_accepted history row per order',
    await q(
      `select order_id, count(*)::int n from public.order_status_history
        where order_id = any ($1) and note = 'driver_accepted' group by 1 having count(*) > 1`,
      [orderIds],
    ),
    'no double accepts',
  );

  // 4) إشعار الأدمن بالطلب الجديد مرة واحدة بالضبط لكل طلب
  add(
    'new-order admin notification exactly once per order',
    await q(
      `select o.id, count(n.id)::int as n
         from public.orders o
         left join public.notification_outbox n
           on n.audience = 'admins' and n.data ->> 'type' = 'new_order' and n.data ->> 'order_id' = o.id::text
        where o.id = any ($1) group by o.id having count(n.id) <> 1`,
      [orderIds],
    ),
    `${orderIds.length} orders`,
  );

  // 5) إشعار "جاهز" للسائق(ين) مرة واحدة بالضبط: طلب وصل ready ← صف drivers(new_order) أو user(ready) واحد؛ غيره صفر
  add(
    'driver notification on ready fires exactly once (drivers new_order xor assigned-driver ready)',
    await q(
      `select o.id, o.ready_at is not null as reached_ready,
              (select count(*) from public.notification_outbox n
                where n.data ->> 'order_id' = o.id::text
                  and ((n.audience = 'drivers' and n.data ->> 'type' = 'new_order')
                    or (n.audience = 'user' and n.data ->> 'type' = 'ready')))::int as n
         from public.orders o
        where o.id = any ($1)
          and (select count(*) from public.notification_outbox n
                where n.data ->> 'order_id' = o.id::text
                  and ((n.audience = 'drivers' and n.data ->> 'type' = 'new_order')
                    or (n.audience = 'user' and n.data ->> 'type' = 'ready')))
              <> case when o.ready_at is not null then 1 else 0 end`,
      [orderIds],
    ),
    'exactly one ready-notification per order that reached ready; none for the others',
  );

  // 6) لا طلبات عالقة (كلها نهائية)
  add(
    'all load orders reached a final status',
    await q(
      `select id, status from public.orders where id = any ($1) and status not in ('delivered', 'cancelled')`,
      [orderIds],
    ),
    'delivered or cancelled',
  );

  // 7) مجاميع الطلب: subtotal = Σ بنود، total = subtotal + أجرة (السعر يُحسب بالقاعدة)
  add(
    'order totals equal their items (price computed in DB)',
    await q(
      `select o.id from public.orders o
        where o.id = any ($1)
          and (o.subtotal_iqd <> public.round_iqd(coalesce((select sum(i.line_total_iqd) from public.order_items i where i.order_id = o.id), 0)::bigint)
               or o.total_iqd <> o.subtotal_iqd + o.delivery_fee_iqd)`,
      [orderIds],
    ),
    'subtotal/total consistent',
  );
  return out;
}

/**
 * تقرير/رئيسية بعد التشغيل مقابل إعادة حساب من الصفوف الخام.
 *  (أ) daily_stats ← rebuild_daily_stats داخل معاملة تُلغى: يجب أن تبقى كل الأيام كما هي (فحص المراجعة).
 *  (ب) dashboard_today (JSON من الأدمن) ← حساب مستقل من orders/inventory_movements لنفس النافذة (as_of).
 *  (ج) report_summary ليوم بغداد كاملاً ← إعادة حساب من الصفوف.
 * dashboard: ناتج rpc dashboard_today. reportSummary: ناتج report_summary(day, day).
 */
export async function verifyReports(db, { dashboard, reportSummary, statsMismatchSql }) {
  const out = [];
  const q = (sql, params) => db.query(sql, params).then((r) => r.rows);
  const add = (name, bad, okDetail) =>
    out.push({
      name,
      ok: bad.length === 0,
      detail: bad.length === 0 ? okDetail : JSON.stringify(bad.slice(0, 6)),
    });

  // (أ) فحص المراجعة: daily_stats مقابل إعادة بنائه من المصدر (الصفوف الخام) على كل الأيام
  add(
    'daily_stats equals recomputation from raw rows (review check, all days)',
    await q(statsMismatchSql),
    'no differing day',
  );

  // (أ2) إعادة بناء فعلية داخل معاملة تُلغى: صفوف daily_stats قبل = بعد (يشمل الهدر والنقص وصافي الربح)
  await db.query('begin');
  try {
    const before = await q(`select to_jsonb(d) as r from public.daily_stats d order by day`);
    await db.query(
      `select private.rebuild_daily_stats(date '2000-01-01', public.baghdad_today() + 1)`,
    );
    const after = await q(`select to_jsonb(d) as r from public.daily_stats d order by day`);
    const strip = (rows) => rows.map((x) => ({ ...x.r, updated_at: undefined }));
    const a = JSON.stringify(strip(before));
    const b = JSON.stringify(strip(after));
    add(
      'rebuild_daily_stats over all history reproduces daily_stats exactly (incl. waste/adjust/net)',
      a === b ? [] : [{ before_days: before.length, after_days: after.length }],
      `${before.length} days identical`,
    );
  } finally {
    await db.query('rollback');
  }

  // (ب) الرئيسية مقابل حساب مستقل لنفس النافذة (as_of الذي رجعته الدالة)
  const raw = (
    await q(
      `with w as (
         select (($1::timestamptz at time zone 'Asia/Baghdad')::date::timestamp at time zone 'Asia/Baghdad') as t0,
                date_trunc('minute', $1::timestamptz) + interval '1 minute' as cut,
                ($1::timestamptz at time zone 'Asia/Baghdad')::date as d)
       select
         (select count(*)::int from public.orders o, w where o.status = 'delivered' and o.delivered_at >= w.t0 and o.delivered_at < w.cut) as delivered_count,
         (select coalesce(sum(o.subtotal_iqd), 0)::bigint from public.orders o, w where o.status = 'delivered' and o.delivered_at >= w.t0 and o.delivered_at < w.cut) as sales_iqd,
         (select count(*)::int from public.orders o, w where o.status = 'cancelled' and o.cancelled_at >= w.t0 and o.cancelled_at < w.cut) as cancelled_count,
         (select count(*)::int from public.orders o, w where o.created_at >= w.t0 and o.created_at < w.cut) as placed_count,
         (select count(*)::int from public.orders where status = 'pending') as pending,
         (select count(*)::int from public.orders where status = 'preparing') as preparing,
         (select count(*)::int from public.orders where status = 'ready') as ready,
         (select count(*)::int from public.orders where status = 'out_for_delivery') as out_for_delivery,
         (select coalesce(sum(-m.qty::bigint * m.unit_cost_iqd) filter (where m.type = 'waste'), 0)::bigint
            from public.inventory_movements m, w
           where m.qty < 0 and (m.created_at at time zone 'Asia/Baghdad')::date = w.d) as waste,
         (select coalesce(sum(-m.qty::bigint * m.unit_cost_iqd) filter (where m.type = 'adjust'), 0)::bigint
            from public.inventory_movements m, w
           where m.qty < 0 and (m.created_at at time zone 'Asia/Baghdad')::date = w.d) as adjust_loss,
         (select coalesce(sum(o.subtotal_iqd), 0)::bigint
            from public.orders o, w
           where o.status = 'delivered' and (o.delivered_at at time zone 'Asia/Baghdad')::date = w.d) as day_revenue,
         (select coalesce(sum(c.cost_snapshot_iqd * i.qty), 0)::bigint
            from public.orders o, w, public.order_items i, public.order_item_costs c
           where o.status = 'delivered' and (o.delivered_at at time zone 'Asia/Baghdad')::date = w.d
             and i.order_id = o.id and c.order_item_id = i.id) as day_cost`,
      [dashboard.as_of],
    )
  )[0];
  const net =
    Number(raw.day_revenue) - Number(raw.day_cost) - Number(raw.waste) - Number(raw.adjust_loss);
  const diffs = [];
  const cmp = (label, got, want) => {
    if (Number(got) !== Number(want))
      diffs.push({ label, dashboard: got, recomputed: Number(want) });
  };
  cmp('delivered_count', dashboard.delivered_count, raw.delivered_count);
  cmp('sales_iqd', dashboard.sales_iqd, raw.sales_iqd);
  cmp('cancelled_count', dashboard.cancelled_count, raw.cancelled_count);
  cmp('placed_count', dashboard.placed_count, raw.placed_count);
  for (const k of ['pending', 'preparing', 'ready', 'out_for_delivery'])
    cmp(`open.${k}`, dashboard.open?.[k], raw[k]);
  cmp('waste_cost_iqd', dashboard.waste_cost_iqd, raw.waste);
  cmp('net_profit_iqd', dashboard.net_profit_iqd, net);
  add(
    'dashboard_today equals independent recomputation (counts, sales, open, waste, net profit)',
    diffs,
    'all fields match',
  );

  // (ج) report_summary لليوم الكامل مقابل إعادة الحساب
  if (reportSummary) {
    const rs = reportSummary;
    const d2 = [];
    const c2 = (label, got, want) => {
      if (got !== undefined && got !== null && Number(got) !== Number(want))
        d2.push({ label, report: got, recomputed: Number(want) });
    };
    c2('sales_iqd', rs.sales_iqd ?? rs.revenue_iqd, raw.day_revenue);
    c2('net_profit_iqd', rs.net_profit_iqd, net);
    c2('waste_cost_iqd', rs.waste_cost_iqd, raw.waste);
    add(
      'report_summary(today) equals recomputation (sales, net profit, waste)',
      d2,
      `sales ${raw.day_revenue}, net ${net}`,
    );
  }
  return out;
}
