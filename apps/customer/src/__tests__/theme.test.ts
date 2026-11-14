// الثيم يطابق docs/design/README.md (مصدر الحقيقة للتصميم).
import fs from 'node:fs';
import path from 'node:path';
import { colors, fonts, radius, sizes, spacing } from '../theme';

const readme = fs.readFileSync(
  path.resolve(__dirname, '../../../../docs/design/README.md'),
  'utf8',
);

describe('theme matches docs/design/README.md', () => {
  it('every color token and hex in the README table', () => {
    const rows = [...readme.matchAll(/^\| `(\w+)` \| `(#[0-9A-F]{6})` \|/gim)].map(
      (m) => [m[1], (m[2] as string).toUpperCase()] as const,
    );
    expect(rows.length).toBe(14);
    expect(Object.fromEntries(rows)).toEqual(colors);
  });

  it('font family and weights', () => {
    expect(readme).toContain('IBM Plex Sans Arabic');
    expect(Object.values(fonts)).toEqual([
      'IBMPlexSansArabic_400Regular',
      'IBMPlexSansArabic_500Medium',
      'IBMPlexSansArabic_600SemiBold',
      'IBMPlexSansArabic_700Bold',
    ]);
  });

  it('radius, spacing and sizes', () => {
    expect(readme).toMatch(/\*\*12\*\* small controls.*\*\*14\*\* inputs.*\*\*16\*\* cards/s);
    expect([radius.control, radius.input, radius.card]).toEqual([12, 14, 16]);
    expect(readme).toMatch(/screen padding \*\*20\*\*; gaps \*\*8 \/ 10 \/ 12 \/ 16\*\*/);
    expect([spacing.screen, spacing.xs, spacing.sm, spacing.md, spacing.lg]).toEqual([
      20, 8, 10, 12, 16,
    ]);
    expect(readme).toMatch(/at least \*\*44 × 44\*\*/);
    expect(readme).toMatch(/Primary button height \*\*56\*\*/);
    expect(readme).toMatch(/Bottom tab bar height \*\*72\*\*/);
    expect(sizes).toEqual({ touchTarget: 44, primaryButton: 56, tabBar: 72 });
  });
});
