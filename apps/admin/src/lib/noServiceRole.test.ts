import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// حارس: لا service_role ولا مفاتيح خادم بأي ملف من اللوحة (CLAUDE.md، SPEC-admin).
const ROOT = join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', '.next', 'playwright-report', 'test-results']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name) || name.startsWith('.env')) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?|mjs|js|json)$/.test(name) ? [p] : [];
  });
}

describe('admin app has no server keys', () => {
  it('no SERVICE_ROLE / sb_secret_ references in source', () => {
    const offenders = files(ROOT)
      .filter((f) => !f.endsWith('noServiceRole.test.ts') && !f.endsWith('env.test.ts'))
      .filter((f) => /service_role|SERVICE_ROLE|sb_secret_/.test(readFileSync(f, 'utf8')))
      .filter((f) => !f.endsWith(join('lib', 'env.ts'))); // رسالة الرفض نفسها
    expect(offenders).toEqual([]);
  });
});
