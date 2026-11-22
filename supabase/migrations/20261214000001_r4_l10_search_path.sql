-- R4 L10 (docs/reviews/R4-cash-review.md, SPEC-cash §12.13): the three older SECURITY DEFINER functions still ran with
-- search_path = public, pg_temp. SPEC-cash K16 and the definer guard expect '' (every name schema-qualified).
--
-- Their latest bodies (update_app_settings: 20261212000001, set_order_status: 20261202000001, assign_driver:
-- 20261125000001) already qualify every table, function, type and schema (public.*, private.*, auth.uid()); what is
-- left unqualified is only columns, variables and pg_catalog built-ins (now, coalesce, jsonb_*, operators), which
-- always resolve with an empty search_path. So this is a pure setting change: no body is rewritten, nothing is dropped,
-- and the grants, owner and security-definer flag stay as they are. supabase/tests/41_search_path_l10.sql runs all
-- three as the real roles to prove they still work.
alter function public.update_app_settings(jsonb) set search_path = '';
alter function public.set_order_status(uuid, public.order_status, text, boolean) set search_path = '';
alter function public.assign_driver(uuid, uuid) set search_path = '';
