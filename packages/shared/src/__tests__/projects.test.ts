import fs from 'node:fs';
import path from 'node:path';
import {
  KNOWN_DEV_PROJECT_REFS,
  isDevSupabaseUrl,
  isProductionOnDevBackend,
  supabaseRefFromUrl,
} from '../projects';

const repo = path.resolve(__dirname, '../../../..');
const read = (...p: string[]) => fs.readFileSync(path.join(repo, ...p), 'utf8');
const refsIn = (src: string, re: RegExp): string[] =>
  [...(re.exec(src)?.[1] ?? '').matchAll(/'([a-z0-9]{20})'/g)].map((m) => m[1] as string).sort();

describe('dev project refs (T23 L8)', () => {
  it('match scripts/lib/projects.mjs DEV_PROJECT_REFS exactly (one source of truth)', () => {
    const fromScripts = refsIn(
      read('scripts', 'lib', 'projects.mjs'),
      /DEV_PROJECT_REFS\s*=\s*\[([^\]]*)\]/,
    );
    expect(fromScripts.length).toBeGreaterThan(0);
    expect([...KNOWN_DEV_PROJECT_REFS].sort()).toEqual(fromScripts);
  });

  it('match the copy inside apps/customer/app.config.ts (build-time guard)', () => {
    const fromConfig = refsIn(
      read('apps', 'customer', 'app.config.ts'),
      /DEV_PROJECT_REFS\s*=\s*\[([^\]]*)\]/,
    );
    expect(fromConfig).toEqual([...KNOWN_DEV_PROJECT_REFS].sort());
  });

  it('never contain a production ref', () => {
    const prod = refsIn(
      read('scripts', 'lib', 'projects.mjs'),
      /PROD_PROJECT_REFS\s*=\s*\[([^\]]*)\]/,
    );
    for (const ref of prod) expect(KNOWN_DEV_PROJECT_REFS).not.toContain(ref);
  });
});

describe('supabaseRefFromUrl / isDevSupabaseUrl', () => {
  const dev = KNOWN_DEV_PROJECT_REFS[0] as string;
  it('reads the ref from a project URL', () => {
    expect(supabaseRefFromUrl(`https://${dev}.supabase.co`)).toBe(dev);
    expect(supabaseRefFromUrl(`https://${dev}.supabase.co/rest/v1/`)).toBe(dev);
    expect(supabaseRefFromUrl(` https://${dev}.supabase.co `)).toBe(dev);
  });
  it('returns null for anything else', () => {
    for (const u of [
      undefined,
      null,
      '',
      'not a url',
      'http://127.0.0.1:54321',
      'https://example.com',
    ]) {
      expect(supabaseRefFromUrl(u)).toBeNull();
    }
  });
  it('a look-alike host is not the dev project', () => {
    expect(isDevSupabaseUrl(`https://${dev}.supabase.co.evil.com`)).toBe(false);
    expect(isDevSupabaseUrl(`https://evil-${dev}.supabase.co`)).toBe(false);
    expect(isDevSupabaseUrl(`https://${dev}.supabase.co`)).toBe(true);
  });
});

describe('isProductionOnDevBackend', () => {
  const devUrl = `https://${KNOWN_DEV_PROJECT_REFS[0]}.supabase.co`;
  it('flags only a production build pointing at a dev project', () => {
    expect(isProductionOnDevBackend('production', devUrl)).toBe(true);
    expect(isProductionOnDevBackend('development', devUrl)).toBe(false);
    expect(isProductionOnDevBackend('preview', devUrl)).toBe(false);
    expect(isProductionOnDevBackend(undefined, devUrl)).toBe(false);
    expect(isProductionOnDevBackend('production', 'https://abcdefghijklmnopqrst.supabase.co')).toBe(
      false,
    );
    expect(isProductionOnDevBackend('production', '')).toBe(false);
  });
});
