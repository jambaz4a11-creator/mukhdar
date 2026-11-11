-- =====================================================================
-- بيانات أساسية للتطوير والعرض (T05)
-- - تُحمَّل تلقائياً محلياً (supabase start / db reset)، وعلى mukhdar-dev يدوياً (RUNBOOK §10).
-- - قابلة للإعادة: لا تكرر شيئاً موجوداً، ولا تغيّر بيانات عدّلها الأدمن.
-- - المستخدمون والطلبات ليست هنا: يصنعها scripts/seed-demo.mjs عبر دوال RPC.
-- افتراض: هيكل القطاعات أدناه مؤقت (10 قطاعات × 3 أقسام × 22 بناية = 660)،
-- والمالك يستبدله بالقوائم الحقيقية لبسماية من لوحة الأدمن.
-- =====================================================================

-- المدينة والإعدادات
insert into public.cities (name) values ('بسماية') on conflict (name) do nothing;

update public.app_settings
   set closed_message = coalesce(closed_message, 'المتجر مغلق حالياً. نستقبل الطلبات يومياً من 8 صباحاً إلى 10 مساءً.')
 where id = 1;

-- القطاعات ← الأقسام الفرعية ← البنايات
insert into public.sectors (city_id, name, sort_order)
select c.id, 'قطاع ' || s.letter, s.n
  from public.cities c,
       unnest(array['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']) with ordinality as s(letter, n)
 where c.name = 'بسماية'
   and not exists (select 1 from public.sectors x where x.city_id = c.id and x.name = 'قطاع ' || s.letter);

insert into public.subsections (sector_id, name, sort_order)
select s.id, 'القسم ' || n, n
  from public.sectors s join public.cities c on c.id = s.city_id and c.name = 'بسماية',
       generate_series(1, 3) n
 where s.name like 'قطاع _'
on conflict (sector_id, name) do nothing;

-- أرقام البنايات متسلسلة عبر المدينة: 1..660
insert into public.buildings (subsection_id, number, sort_order)
select ss.id, ((s.sort_order - 1) * 66 + (ss.sort_order - 1) * 22 + b)::text, b
  from public.subsections ss
  join public.sectors s on s.id = ss.sector_id
  join public.cities c on c.id = s.city_id and c.name = 'بسماية',
       generate_series(1, 22) b
 where s.name like 'قطاع _' and ss.name like 'القسم _'
on conflict (subsection_id, number) do nothing;

-- الأقسام (6)
insert into public.categories (name, sort_order)
select v.name, v.n
  from (values ('خضروات', 1), ('فواكه', 2), ('ورقيات وأعشاب', 3),
               ('فواكه مستوردة', 4), ('تمور ومجففات', 5), ('سلال جاهزة', 6)) v(name, n)
 where not exists (select 1 from public.categories c where c.name = v.name);

-- المنتجات (60): القسم، الاسم، الوحدة، سعر البيع، سعر الشراء، الرصيد الابتدائي
create temporary table seed_products (cat text, name text, unit text, price bigint, cost bigint, qty int);
insert into seed_products values
  ('خضروات', 'طماطة', 'كيلو', 1000, 650, 120), ('خضروات', 'خيار', 'كيلو', 1000, 600, 120),
  ('خضروات', 'بطاطا', 'كيلو', 750, 450, 200), ('خضروات', 'بصل أحمر', 'كيلو', 750, 400, 150),
  ('خضروات', 'بصل أبيض', 'كيلو', 1000, 600, 80), ('خضروات', 'باذنجان', 'كيلو', 1000, 550, 90),
  ('خضروات', 'شجر (كوسة)', 'كيلو', 1250, 750, 80), ('خضروات', 'فلفل أخضر', 'كيلو', 1500, 900, 60),
  ('خضروات', 'فلفل حار', 'كيلو', 2000, 1200, 30), ('خضروات', 'جزر', 'كيلو', 1000, 600, 100),
  ('فواكه', 'برتقال', 'كيلو', 1500, 950, 120), ('فواكه', 'لالنكي', 'كيلو', 1750, 1100, 90),
  ('فواكه', 'تفاح أحمر', 'كيلو', 2000, 1300, 100), ('فواكه', 'تفاح أصفر', 'كيلو', 2000, 1300, 80),
  ('فواكه', 'موز', 'كيلو', 1750, 1150, 150), ('فواكه', 'رمان', 'كيلو', 2500, 1600, 70),
  ('فواكه', 'عنب', 'كيلو', 2500, 1650, 60), ('فواكه', 'ركي (بطيخ)', 'حبة', 5000, 3200, 40),
  ('فواكه', 'بطيخ أصفر', 'حبة', 4000, 2600, 40), ('فواكه', 'ليمون حامض', 'كيلو', 2000, 1250, 60),
  ('ورقيات وأعشاب', 'كرفس', 'باقة', 250, 125, 100), ('ورقيات وأعشاب', 'معدنوس', 'باقة', 250, 125, 150),
  ('ورقيات وأعشاب', 'نعناع', 'باقة', 250, 125, 150), ('ورقيات وأعشاب', 'ريحان', 'باقة', 250, 125, 80),
  ('ورقيات وأعشاب', 'كزبرة', 'باقة', 250, 125, 100), ('ورقيات وأعشاب', 'خس', 'حبة', 750, 400, 80),
  ('ورقيات وأعشاب', 'لهانة', 'حبة', 1000, 600, 50), ('ورقيات وأعشاب', 'سبانغ', 'باقة', 500, 300, 60),
  ('ورقيات وأعشاب', 'بصل أخضر', 'باقة', 250, 125, 100), ('ورقيات وأعشاب', 'شبنت', 'باقة', 250, 125, 60),
  ('فواكه مستوردة', 'كيوي', 'كيلو', 4000, 2700, 40), ('فواكه مستوردة', 'أناناس', 'حبة', 5000, 3400, 25),
  ('فواكه مستوردة', 'مانجو', 'كيلو', 5000, 3500, 30), ('فواكه مستوردة', 'أفوكادو', 'كيلو', 7000, 5000, 20),
  ('فواكه مستوردة', 'فراولة', 'علبة', 3000, 2000, 40), ('فواكه مستوردة', 'كمثرى', 'كيلو', 3500, 2400, 40),
  ('فواكه مستوردة', 'خوخ', 'كيلو', 3500, 2300, 40), ('فواكه مستوردة', 'مشمش', 'كيلو', 4000, 2700, 30),
  ('فواكه مستوردة', 'كرز', 'علبة', 6000, 4200, 20), ('فواكه مستوردة', 'جوز الهند', 'حبة', 3000, 2000, 20),
  ('تمور ومجففات', 'تمر برحي', 'كيلو', 4000, 2600, 60), ('تمور ومجففات', 'تمر زهدي', 'كيلو', 2000, 1200, 80),
  ('تمور ومجففات', 'تمر خستاوي', 'كيلو', 3500, 2300, 50), ('تمور ومجففات', 'تمر مجهول', 'كيلو', 12000, 8500, 20),
  ('تمور ومجففات', 'تين مجفف', 'كيلو', 8000, 5500, 20), ('تمور ومجففات', 'زبيب', 'كيلو', 6000, 4000, 30),
  ('تمور ومجففات', 'مشمش مجفف', 'كيلو', 9000, 6200, 20), ('تمور ومجففات', 'دبس تمر', 'قنينة', 3000, 1900, 40),
  ('تمور ومجففات', 'لوز', 'كيلو', 15000, 11000, 15), ('تمور ومجففات', 'جوز', 'كيلو', 14000, 10000, 15),
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
