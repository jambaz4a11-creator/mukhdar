-- =====================================================================
-- بيانات أساسية للتطوير والعرض (T05)
-- - تُحمَّل تلقائياً محلياً (supabase start / db reset)، وعلى mukhdar-dev يدوياً (RUNBOOK §10).
-- - قابلة للإعادة: لا تكرر شيئاً موجوداً، ولا تغيّر بيانات عدّلها الأدمن.
-- - المستخدمون والطلبات ليست هنا: يصنعها scripts/seed-demo.mjs عبر دوال RPC.
-- هيكل العناوين (قرار المالك 2026-11-14): قطاعان A و B؛ القطاع A وحداته A1..A9، والقطاع B وحداته B1..B8؛
-- كل وحدة عماراتها 1..100 (17 وحدة × 100 = 1700 عمارة). بالواجهة: subsection = "وحدة"، building = "عمارة".
-- وحدة البيع (قرار المالك): الخضار والفواكه بالـ "نص كيلو" (السعر لكل نص كيلو، والكمية عدد أنصاف الكيلو)،
-- والأعشاب "باقة"، وما يُباع بالقطعة يبقى (حبة، علبة، قنينة، سلة).
-- =====================================================================

-- المدينة والإعدادات
insert into public.cities (name) values ('بسماية') on conflict (name) do nothing;

update public.app_settings
   set closed_message = coalesce(closed_message, 'المتجر مغلق حالياً. نستقبل الطلبات يومياً من 8 صباحاً إلى 10 مساءً.')
 where id = 1;

-- القطاعات ← الوحدات ← العمارات
insert into public.sectors (city_id, name, sort_order)
select c.id, 'قطاع ' || s.letter, s.n
  from public.cities c,
       unnest(array['A', 'B']) with ordinality as s(letter, n)
 where c.name = 'بسماية'
   and not exists (select 1 from public.sectors x where x.city_id = c.id and x.name = 'قطاع ' || s.letter);

-- A1..A9 و B1..B8
insert into public.subsections (sector_id, name, sort_order)
select s.id, v.letter || v.n, v.n
  from public.sectors s join public.cities c on c.id = s.city_id and c.name = 'بسماية',
       (select 'A' as letter, generate_series(1, 9) as n
        union all
        select 'B', generate_series(1, 8)) v
 where s.name = 'قطاع ' || v.letter
on conflict (sector_id, name) do nothing;

-- العمارات 1..100 داخل كل وحدة (الرقم يتكرر بين الوحدات)
insert into public.buildings (subsection_id, number, sort_order)
select ss.id, b::text, b
  from public.subsections ss
  join public.sectors s on s.id = ss.sector_id
  join public.cities c on c.id = s.city_id and c.name = 'بسماية',
       generate_series(1, 100) b
 where s.name in ('قطاع A', 'قطاع B') and ss.name ~ '^[AB][0-9]$'
on conflict (subsection_id, number) do nothing;

-- الأقسام (6)
insert into public.categories (name, sort_order)
select v.name, v.n
  from (values ('خضروات', 1), ('فواكه', 2), ('ورقيات وأعشاب', 3),
               ('فواكه مستوردة', 4), ('تمور ومجففات', 5), ('سلال جاهزة', 6)) v(name, n)
 where not exists (select 1 from public.categories c where c.name = v.name);

-- المنتجات (60): القسم، الاسم، الوحدة، سعر البيع، سعر الشراء، الرصيد الابتدائي (بوحدة البيع)
create temporary table seed_products (cat text, name text, unit text, price bigint, cost bigint, qty int);
insert into seed_products values
  ('خضروات', 'طماطة', 'نص كيلو', 500, 325, 240), ('خضروات', 'خيار', 'نص كيلو', 500, 300, 240),
  ('خضروات', 'بطاطا', 'نص كيلو', 500, 225, 400), ('خضروات', 'بصل أحمر', 'نص كيلو', 500, 200, 300),
  ('خضروات', 'بصل أبيض', 'نص كيلو', 500, 300, 160), ('خضروات', 'باذنجان', 'نص كيلو', 500, 275, 180),
  ('خضروات', 'شجر (كوسة)', 'نص كيلو', 750, 375, 160), ('خضروات', 'فلفل أخضر', 'نص كيلو', 750, 450, 120),
  ('خضروات', 'فلفل حار', 'نص كيلو', 1000, 600, 60), ('خضروات', 'جزر', 'نص كيلو', 500, 300, 200),
  ('فواكه', 'برتقال', 'نص كيلو', 750, 475, 240), ('فواكه', 'لالنكي', 'نص كيلو', 1000, 550, 180),
  ('فواكه', 'تفاح أحمر', 'نص كيلو', 1000, 650, 200), ('فواكه', 'تفاح أصفر', 'نص كيلو', 1000, 650, 160),
  ('فواكه', 'موز', 'نص كيلو', 1000, 575, 300), ('فواكه', 'رمان', 'نص كيلو', 1250, 800, 140),
  ('فواكه', 'عنب', 'نص كيلو', 1250, 825, 120), ('فواكه', 'ركي (بطيخ)', 'حبة', 5000, 3200, 40),
  ('فواكه', 'بطيخ أصفر', 'حبة', 4000, 2600, 40), ('فواكه', 'ليمون حامض', 'نص كيلو', 1000, 625, 120),
  ('ورقيات وأعشاب', 'كرفس', 'باقة', 250, 125, 100), ('ورقيات وأعشاب', 'معدنوس', 'باقة', 250, 125, 150),
  ('ورقيات وأعشاب', 'نعناع', 'باقة', 250, 125, 150), ('ورقيات وأعشاب', 'ريحان', 'باقة', 250, 125, 80),
  ('ورقيات وأعشاب', 'كزبرة', 'باقة', 250, 125, 100), ('ورقيات وأعشاب', 'خس', 'حبة', 750, 400, 80),
  ('ورقيات وأعشاب', 'لهانة', 'حبة', 1000, 600, 50), ('ورقيات وأعشاب', 'سبانغ', 'باقة', 500, 300, 60),
  ('ورقيات وأعشاب', 'بصل أخضر', 'باقة', 250, 125, 100), ('ورقيات وأعشاب', 'شبنت', 'باقة', 250, 125, 60),
  ('فواكه مستوردة', 'كيوي', 'نص كيلو', 2000, 1350, 80), ('فواكه مستوردة', 'أناناس', 'حبة', 5000, 3400, 25),
  ('فواكه مستوردة', 'مانجو', 'نص كيلو', 2500, 1750, 60), ('فواكه مستوردة', 'أفوكادو', 'نص كيلو', 3500, 2500, 40),
  ('فواكه مستوردة', 'فراولة', 'علبة', 3000, 2000, 40), ('فواكه مستوردة', 'كمثرى', 'نص كيلو', 1750, 1200, 80),
  ('فواكه مستوردة', 'خوخ', 'نص كيلو', 1750, 1150, 80), ('فواكه مستوردة', 'مشمش', 'نص كيلو', 2000, 1350, 60),
  ('فواكه مستوردة', 'كرز', 'علبة', 6000, 4200, 20), ('فواكه مستوردة', 'جوز الهند', 'حبة', 3000, 2000, 20),
  ('تمور ومجففات', 'تمر برحي', 'نص كيلو', 2000, 1300, 120), ('تمور ومجففات', 'تمر زهدي', 'نص كيلو', 1000, 600, 160),
  ('تمور ومجففات', 'تمر خستاوي', 'نص كيلو', 1750, 1150, 100), ('تمور ومجففات', 'تمر مجهول', 'نص كيلو', 6000, 4250, 40),
  ('تمور ومجففات', 'تين مجفف', 'نص كيلو', 4000, 2750, 40), ('تمور ومجففات', 'زبيب', 'نص كيلو', 3000, 2000, 60),
  ('تمور ومجففات', 'مشمش مجفف', 'نص كيلو', 4500, 3100, 40), ('تمور ومجففات', 'دبس تمر', 'قنينة', 3000, 1900, 40),
  ('تمور ومجففات', 'لوز', 'نص كيلو', 7500, 5500, 30), ('تمور ومجففات', 'جوز', 'نص كيلو', 7000, 5000, 30),
  ('سلال جاهزة', 'سلة سلطة', 'سلة', 3000, 1900, 30), ('سلال جاهزة', 'سلة طبخ يومي', 'سلة', 5000, 3300, 30),
  ('سلال جاهزة', 'سلة فواكه صغيرة', 'سلة', 7000, 4700, 25), ('سلال جاهزة', 'سلة فواكه عائلية', 'سلة', 15000, 10200, 15),
  ('سلال جاهزة', 'سلة عصير', 'سلة', 6000, 4000, 20), ('سلال جاهزة', 'سلة رمضان', 'سلة', 25000, 17500, 10),
  ('سلال جاهزة', 'سلة مشاوي', 'سلة', 4000, 2600, 20), ('سلال جاهزة', 'سلة ورقيات', 'سلة', 1500, 900, 30),
  ('سلال جاهزة', 'سلة أطفال', 'سلة', 5000, 3300, 20), ('سلال جاهزة', 'سلة هدية', 'سلة', 20000, 14000, 10);

-- منتج جديد فقط (المنتجات الموجودة لا تُلمس: قد يكون الأدمن عدّلها)
with ins as (
  insert into public.products (category_id, city_id, name, unit, price_iqd, sort_order)
  select c.id, (select id from public.cities where name = 'بسماية'), sp.name, sp.unit, sp.price,
         row_number() over (partition by sp.cat order by sp.name)
    from seed_products sp join public.categories c on c.name = sp.cat
   where not exists (select 1 from public.products p where p.category_id = c.id and p.name = sp.name)
  returning id, name, category_id
)
insert into public.product_costs (product_id, cost_iqd)
select ins.id, sp.cost
  from ins join public.categories c on c.id = ins.category_id join seed_products sp on sp.cat = c.name and sp.name = ins.name;

-- الرصيد الابتدائي للمنتجات التي رصيدها صفر ولا حركات لها (أي الجديدة)، مع حركة purchase بالدفتر
with s as (
  update public.stock st set qty = sp.qty, updated_at = now()
    from public.products p join public.categories c on c.id = p.category_id
    join seed_products sp on sp.cat = c.name and sp.name = p.name
   where st.product_id = p.id and st.qty = 0
     and not exists (select 1 from public.inventory_movements m where m.product_id = p.id)
  returning st.product_id, st.qty
)
insert into public.inventory_movements (product_id, qty, type, note)
select product_id, qty, 'purchase', 'رصيد ابتدائي (seed)' from s;

drop table seed_products;
