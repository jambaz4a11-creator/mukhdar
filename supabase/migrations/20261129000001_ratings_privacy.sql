-- مراجعة C (docs/reviews/review-C-T20-T26.md)، جلسة D: ثلاثة بنود Low بـ migration واحدة.
--   L2: rate_order يوسّع إزالة المحارف غير المرئية (C1، العرض الصفري، فواصل الأسطر/الفقرات، وbidi
--       overrides/isolates) ويحوّل CR إلى LF. توقيع الدالة لا يتغير.
--   L3: ratings_list لا يُرجع اسم الزبون إن حُذف حسابه (ratings.customer_id = null): الاسم بيانات
--       شخصية بجانب رأيه الحر، ولا حاجة محاسبية له بعد الحذف. لقطة الاسم بالطلب نفسه تبقى (SPEC-backend §4).
--   L4: حذف ratings_created_idx؛ ratings_keyset_idx (created_at desc, order_id desc) يخدم كل استعلاماته.
-- لا تغيير بالصلاحيات: create or replace يحفظ الـ grants.

-- ---------------------------------------------------------------------
-- L2) rate_order
-- ---------------------------------------------------------------------
create or replace function public.rate_order(p_order_id uuid, p_stars int, p_comment text default null)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_active  boolean;
  v_flagged boolean;
  v_comment text;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select is_active, must_change_pin into v_active, v_flagged from public.profiles where id = v_uid;
  if v_active is distinct from true then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if v_flagged then
    raise exception 'PIN_CHANGE_REQUIRED' using errcode = '42501';
  end if;
  if p_stars is null or p_stars not between 1 and 5 then
    raise exception 'INVALID_STARS' using errcode = 'P0001';
  end if;
  -- نص صرف: CR ← LF أولاً، ثم إزالة محارف التحكم (عدا TAB وLF) وC1 والعرض الصفري وفواصل الأسطر/الفقرات
  -- وbidi (U+202A-202E, U+2066-2069)، ثم قص الفراغ، والفارغ يصير null
  v_comment := nullif(
    btrim(
      regexp_replace(
        regexp_replace(coalesce(p_comment, ''), '\r\n?', E'\n', 'g'),
        '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F​-‏ -‮⁠-⁩﻿]', '', 'g'),
      E' \t\n'),
    '');
  if char_length(v_comment) > 500 then
    raise exception 'COMMENT_TOO_LONG' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.orders
                  where id = p_order_id and customer_id = v_uid and status = 'delivered') then
    raise exception 'ORDER_NOT_RATEABLE' using errcode = 'P0001';
  end if;
  insert into public.ratings (order_id, customer_id, stars, comment)
  values (p_order_id, v_uid, p_stars, v_comment)
  on conflict (order_id) do nothing;
  if not found then
    raise exception 'ALREADY_RATED' using errcode = 'P0001';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- L3) ratings_list: لا اسم لزبون محذوف
-- ---------------------------------------------------------------------
create or replace function public.ratings_list(
  p_from date default null, p_to date default null,
  p_min_stars int default 1, p_max_stars int default 5, p_with_comment boolean default false,
  p_before_created timestamptz default null, p_before_order uuid default null, p_limit int default 50)
returns table (
  order_id uuid, order_number bigint, customer_name text, stars smallint, comment text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform private.ratings_guard(p_from, p_to, p_min_stars, p_max_stars);
  return query
    select r.order_id, o.order_number,
           case when r.customer_id is null then null else o.customer_name end,
           r.stars, r.comment, r.created_at
      from public.ratings r
      join public.orders o on o.id = r.order_id
     where (p_from is null or r.created_at >= private.baghdad_start(p_from))
       and (p_to   is null or r.created_at <  private.baghdad_start(p_to + 1))
       and r.stars between p_min_stars and p_max_stars
       and (not coalesce(p_with_comment, false) or r.comment is not null)
       and (p_before_created is null or p_before_order is null
            or (r.created_at, r.order_id) < (p_before_created, p_before_order))
     order by r.created_at desc, r.order_id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 100);
end
$$;

-- ---------------------------------------------------------------------
-- L4) فهرس زائد
-- ---------------------------------------------------------------------
drop index if exists public.ratings_created_idx;
