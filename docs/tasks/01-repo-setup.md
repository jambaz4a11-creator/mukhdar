# 01: إعداد الـ monorepo

**الهدف:** هيكل `mukhdar/` كما في ARCHITECTURE §2، جاهز للبناء والاختبار.

## الخطوات
- pnpm workspaces: `apps/*`، `packages/*`. Node LTS (ملف `.nvmrc`).
- TypeScript strict مشترك (`tsconfig.base.json`)، ESLint + Prettier.
- `.gitignore` (node_modules، .expo، .next، .env*، supabase/.temp).
- `.env.example` لكل تطبيق (`SUPABASE_URL`، `SUPABASE_ANON_KEY`، `SENTRY_DSN`). لا مفاتيح حقيقية بالـ git.
- GitHub Actions: `lint` + `typecheck` + `test` على كل push.
- Supabase CLI كـ devDependency.

## القبول
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test` تمر على مستودع فارغ.
- CI أخضر.

## الاختبارات
- اختبار Jest تجريبي واحد بـ `packages/shared` للتأكد من تشغيل الإعداد.
