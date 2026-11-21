-- T36 (W3) migration A: قيم enum لـ Web Push (SPEC-webpush §5.3).
-- ملف مستقل: PostgreSQL لا يسمح باستعمال قيمة enum أُضيفت بنفس المعاملة، فالقيود والدوال التي تستعملها
-- بـ migration B (20261210000002_webpush_db.sql).
alter type public.push_provider add value if not exists 'webpush';
alter type public.push_platform add value if not exists 'web';
