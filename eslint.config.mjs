import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/.expo/**',
      '**/.next/**',
      '**/.open-next/**',
      '**/.wrangler/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
  },
  {
    files: ['scripts/**/*.mjs', 'apps/*/e2e/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node },
  },
  {
    // خدمة الإشعارات (T38): سكربت Service Worker بلا وحدات (ES5 عمداً: يُقدَّم كما هو ويُختبر بـ vm)
    files: ['apps/*/public/sw.js'],
    languageOptions: { sourceType: 'script', globals: globals.serviceworker },
    rules: { 'no-var': 'off', 'prefer-const': 'off' },
  },
  {
    // اختبارات Deno: assert يتحقق قبل الوصول، فالـ non-null assertion مقبول هنا.
    files: ['supabase/functions/**/*_test.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  prettier,
);
