#!/usr/bin/env node
// يطبّق شجرة عناوين بسماية الدقيقة من data.json (قرار المالك 2026-11-19). قابل للإعادة (idempotent).
//   node scripts/address-tree/run.mjs --remote            معاينة على mukhdar-dev (لا يكتب شيئاً)
//   node scripts/address-tree/run.mjs --remote --apply    تنفيذ على mukhdar-dev
// الإنتاج (عند الإطلاق): مرفوض افتراضياً؛ مسار صريح ثلاثي كسكربت الصور: --target=prod + MUKHDAR_TARGET=prod +
//   --confirm-ref=<ref الإنتاج>، من نسخة الإنتاج المنفصلة (RUNBOOK §17.2).
// القواعد: البلوكات المذكورة فعّالة بعماراتها 1..N فقط؛ كل ما عداها (بلوك أو عمارة) يُخفى (is_active = false).
// لا حذف أبداً (العناوين والطلبات تشير للعمارات)، ولا يمس العناوين ولا الطلبات. ينقص الشجرة؟ يُنشأ (insert فقط).
// يطبع بالنهاية العناوين المحفوظة غير الصالحة (طابق ناقص أو خارج G..9، شقة خارج 1..12، بلوك مخفي، عمارة خارج البلوك).
import fs from 'node:fs';
import path from 'node:path';
import { connect, connectDev, describe, resolveTarget } from '../lib/db.mjs';
import { refFromPoolerUrl } from '../lib/projects.mjs';
import { resolveImageTarget } from '../product-images/guard.mjs';
import { addressProblems, buildingNumbers, validateData, wantedSectors } from './lib.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const data = validateData(
  JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data.json'), 'utf8')),
);

const target = resolveTarget(args);
const kind = resolveImageTarget(target, args); // 'dev' أو 'prod' (بالشروط الثلاثة) وإلا يرمي
if (kind === 'prod' && refFromPoolerUrl(target.poolerUrl) !== target.projectRef) {
  throw new Error('Refusing: the pooler URL does not point to the linked production project.');
}
const client = kind === 'dev' ? await connectDev(target) : await connect(target);
console.log(`${apply ? 'APPLY' : 'DRY RUN'} (${kind}) on ${describe(target)}`);

try {
  await client.query('begin');
  const { rows: cities } = await client.query('select id from public.cities where name = $1', [
    data.city,
  ]);
  if (cities.length !== 1)
    throw new Error(`city "${data.city}" not found (apply supabase/seed.sql)`);
  const cityId = cities[0].id;

  // القطاعات المطلوبة: إنشاء إن غابت، ثم تفعيلها وإخفاء ما عداها
  const wanted = wantedSectors(data);
  for (const name of wanted) {
    await client.query(
      `insert into public.sectors (city_id, name, sort_order)
       select $1::smallint, $2::text,
              coalesce((select max(sort_order) from public.sectors where city_id = $1::smallint), 0) + 1
        where not exists (select 1 from public.sectors where city_id = $1::smallint and name = $2::text)`,
      [cityId, name],
    );
  }
  await client.query(
    'update public.sectors set is_active = (name = any($2::text[])) where city_id = $1',
    [cityId, wanted],
  );
  const { rows: sectors } = await client.query(
    'select id, name from public.sectors where city_id = $1',
    [cityId],
  );
  const sectorId = new Map(sectors.map((s) => [s.name, s.id]));

  // البلوكات (الوحدات) والعمارات
  const listedBlockIds = [];
  for (const b of data.blocks) {
    const { rows: sub } = await client.query(
      `insert into public.subsections (sector_id, name, sort_order, is_active)
       values ($1, $2, $3, true)
       on conflict (sector_id, name) do update set is_active = true, sort_order = excluded.sort_order
       returning id`,
      [sectorId.get(b.sector), b.name, Number(b.name.slice(1))],
    );
    const subId = sub[0].id;
    listedBlockIds.push(subId);
    const numbers = buildingNumbers(b.buildings);
    await client.query(
      `insert into public.buildings (subsection_id, number, sort_order)
       select $1, n, n::int from unnest($2::text[]) n
       on conflict (subsection_id, number) do nothing`,
      [subId, numbers],
    );
    await client.query(
      'update public.buildings set is_active = (number = any($2::text[])) where subsection_id = $1',
      [subId, numbers],
    );
  }
  // أي بلوك غير مذكور (بأي قطاع) يُخفى مع عماراته
  await client.query(
    'update public.subsections set is_active = false where not (id = any($1::int[])) and is_active',
    [listedBlockIds],
  );
  await client.query(
    `update public.buildings set is_active = false
      where not (subsection_id = any($1::int[])) and is_active`,
    [listedBlockIds],
  );

  // تقرير الشجرة
  const { rows: tree } = await client.query(
    `select s.name as sector, ss.name as block, ss.is_active as block_active,
            count(*) filter (where b.is_active)::int as active,
            count(b.id)::int as total,
            coalesce(max(b.number::int) filter (where b.is_active), 0)::int as max_active
       from public.subsections ss
       join public.sectors s on s.id = ss.sector_id and s.city_id = $1
       left join public.buildings b on b.subsection_id = ss.id
      group by s.name, ss.name, ss.is_active, ss.sort_order, s.sort_order
      order by s.sort_order, ss.sort_order`,
    [cityId],
  );
  console.log('\nBlocks:');
  for (const t of tree) {
    console.log(
      t.block_active
        ? `  ${t.block}  active, buildings 1..${t.max_active} (${t.active} active of ${t.total})`
        : `  ${t.block}  HIDDEN (all ${t.total} buildings hidden)`,
    );
  }
  const bad = tree.filter(
    (t) => t.block_active && data.blocks.find((b) => b.name === t.block)?.buildings !== t.active,
  );
  if (bad.length) throw new Error(`mismatch after apply: ${bad.map((b) => b.block).join(', ')}`);

  // العناوين المحفوظة غير الصالحة بعد التطبيق (للإبلاغ فقط؛ لا تعديل)
  const { rows: addrs } = await client.query(
    `select a.id, a.floor, a.apartment, ss.name as block, b.number as building,
            b.is_active as building_active, ss.is_active as block_active, s.is_active as sector_active,
            (select count(*) from public.orders o where o.address_id = a.id)::int as orders
       from public.addresses a
       join public.buildings b on b.id = a.building_id
       join public.subsections ss on ss.id = b.subsection_id
       join public.sectors s on s.id = ss.sector_id
      order by ss.name, b.number::int, a.apartment`,
  );
  const invalid = addrs
    .map((a) => ({ ...a, problems: addressProblems(a) }))
    .filter((a) => a.problems.length > 0);
  console.log(`\nSaved addresses: ${addrs.length}, invalid under the new rules: ${invalid.length}`);
  for (const a of invalid) {
    console.log(
      `  ${a.id}  ${a.block}/${a.building} floor=${a.floor ?? '-'} apt="${a.apartment}"  ` +
        `orders=${a.orders}  -> ${a.problems.join('; ')}`,
    );
  }

  await client.query(apply ? 'commit' : 'rollback');
  console.log(apply ? '\nApplied.' : '\nDry run: nothing changed (add --apply).');
} catch (err) {
  await client.query('rollback').catch(() => {});
  throw err;
} finally {
  await client.end();
}
