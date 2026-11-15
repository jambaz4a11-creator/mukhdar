import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// ألوان اللوحة = جدول الألوان بـ docs/design/README.md (نفس رموز تطبيق الزبون).
const readme = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'docs', 'design', 'README.md'),
  'utf8',
);
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('admin theme matches docs/design/README.md', () => {
  const rows = [...readme.matchAll(/^\| `([a-zA-Z]+)` \| `(#[0-9A-Fa-f]{6})` \|/gm)].map(
    (m): [string, string] => [m[1] ?? '', m[2] ?? ''],
  );

  it('reads the color table', () => {
    expect(rows.length).toBeGreaterThanOrEqual(10);
  });

  it.each(rows)('--color-%s = %s', (token, hex) => {
    const m = css.match(new RegExp(`--color-${kebab(token)}:\\s*(#[0-9a-fA-F]{6});`));
    expect(m?.[1]?.toLowerCase()).toBe(hex.toLowerCase());
  });

  it('radii 12 / 14 / 16', () => {
    expect(css).toMatch(/--radius-control:\s*12px/);
    expect(css).toMatch(/--radius-input:\s*14px/);
    expect(css).toMatch(/--radius-card:\s*16px/);
  });
});
