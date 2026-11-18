#!/usr/bin/env node
// يخفي أو يحذف منتجات بالاسم (للتطوير فقط: نفس حماية seed:demo). مثال:
//   node scripts/hide-products.mjs --remote --match=سلة            -> معاينة فقط
//   node scripts/hide-products.mjs --remote --match=سلة --apply    -> تنفيذ
// قاعدة (قرار المالك 2026-11-18): منتج له تاريخ (بنود طلبات أو حركات مخزون أو تقييمات مرتبطة) يُخفى فقط
// (is_active = false: لا يظهر للزبون ولا يُفقد التاريخ)؛ منتج بلا أي تاريخ يُحذف مع صف مخزونه.
// لا يغيّر الاسم ولا السعر ولا الرصيد ولا القسم.
import { assertSafeTarget, connectDev, describe, resolveTarget } from './lib/db.mjs';

const args = process.argv.slice(2);
const match = args.find((a) => a.startsWith('--match='))?.slice('--match='.length);
const apply = args.includes('--apply');
if (!match) {
  console.error('usage: hide-products.mjs [--remote] --match=<text in name> [--apply]');
  process.exit(2);
}

const target = resolveTarget(args);
assertSafeTarget(target);
const client = await connectDev(target);
console.log(
  `${apply ? 'APPLY' : 'DRY RUN'} on ${describe(target)}: products whose name contains "${match}"`,
);
try {
  await client.query('begin');
  const { rows } = await client.query(
    `select p.id, p.name, p.is_active,
            (select count(*) from public.order_items i where i.product_id = p.id)::int as items,
            (select count(*) from public.inventory_movements m where m.product_id = p.id)::int as moves
       from public.products p where position($1 in p.name) > 0 order by p.name`,
    [match],
  );
  let hidden = 0;
  let deleted = 0;
  for (const p of rows) {
    const history = p.items + p.moves > 0;
    console.log(
      `${history ? 'HIDE  ' : 'DELETE'} ${p.name} (order items ${p.items}, stock moves ${p.moves})`,
    );
    if (!apply) continue;
    if (history) {
      await client.query('update public.products set is_active = false where id = $1', [p.id]);
      hidden++;
    } else {
      await client.query('delete from public.stock where product_id = $1', [p.id]);
      await client.query('delete from public.products where id = $1', [p.id]);
      deleted++;
    }
  }
  await client.query(apply ? 'commit' : 'rollback');
  console.log(
    `${rows.length} found; hidden ${hidden}, deleted ${deleted}${apply ? '' : ' (dry run, nothing changed)'}`,
  );
} catch (err) {
  await client.query('rollback').catch(() => {});
  throw err;
} finally {
  await client.end();
}
