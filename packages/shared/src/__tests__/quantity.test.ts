import fs from 'node:fs';
import path from 'node:path';
import { BUNCH_UNIT, formatQuantity, HALF_KILO_UNIT, isSaleUnit, SALE_UNITS } from '../quantity';

const repoRoot = path.resolve(__dirname, '../../../..');

/** آخر قيد products_unit_allowed بملفات migrations (الأحدث يغلب). */
function constraintUnits(): string[] {
  const dir = path.join(repoRoot, 'supabase', 'migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  let units: string[] = [];
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = /products_unit_allowed\s+check\s*\(\s*unit\s+in\s*\(([^)]*)\)/i.exec(sql);
    if (m) units = [...(m[1] as string).matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
  }
  return units;
}

describe('SALE_UNITS', () => {
  it('matches the products_unit_allowed constraint exactly', () => {
    expect(constraintUnits().length).toBeGreaterThan(0);
    expect([...SALE_UNITS].sort()).toEqual(constraintUnits().sort());
  });

  it('covers every unit used in seed.sql', () => {
    const seed = fs.readFileSync(path.join(repoRoot, 'supabase', 'seed.sql'), 'utf8');
    const rows = [...seed.matchAll(/\('[^']+', '[^']+', '([^']+)', \d+/g)].map((m) => m[1]);
    expect(rows.length).toBeGreaterThan(30);
    expect(rows.filter((u) => !isSaleUnit(u))).toEqual([]);
  });

  it('isSaleUnit rejects free text', () => {
    expect(isSaleUnit(HALF_KILO_UNIT)).toBe(true);
    expect(isSaleUnit('كيس')).toBe(true);
    expect(isSaleUnit('عبوة')).toBe(true);
    expect(isSaleUnit('كيلو')).toBe(false);
    expect(isSaleUnit('نصف كيلو')).toBe(false);
    expect(isSaleUnit(3)).toBe(false);
  });
});

describe('formatQuantity', () => {
  it.each([
    [1, 'نص كيلو'],
    [2, '1 كيلو'],
    [3, '1.5 كيلو'],
    [4, '2 كيلو'],
    [5, '2.5 كيلو'],
    [20, '10 كيلو'],
    [99, '49.5 كيلو'],
  ])('half-kilo unit: %i → %s', (qty, expected) => {
    expect(formatQuantity(qty, HALF_KILO_UNIT)).toBe(expected);
  });

  it.each([
    [1, '1 باقة'],
    [2, '2 باقة'],
    [12, '12 باقة'],
  ])('bunch: %i → %s', (qty, expected) => {
    expect(formatQuantity(qty, BUNCH_UNIT)).toBe(expected);
  });

  it('other piece units are shown as "N unit"', () => {
    expect(formatQuantity(1, 'حبة')).toBe('1 حبة');
    expect(formatQuantity(3, 'سلة')).toBe('3 سلة');
    expect(formatQuantity(2, 'كيس')).toBe('2 كيس');
    expect(formatQuantity(4, 'عبوة')).toBe('4 عبوة');
  });

  it('tolerates surrounding spaces in the stored unit', () => {
    expect(formatQuantity(2, ' نص كيلو ')).toBe('1 كيلو');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a non-positive or fractional quantity (%p)', (qty) => {
    expect(() => formatQuantity(qty, HALF_KILO_UNIT)).toThrow(RangeError);
  });

  it('the seed uses only half-kilo for produce (no plain كيلو unit left)', () => {
    const seed = fs.readFileSync(path.resolve(__dirname, '../../../../supabase/seed.sql'), 'utf8');
    const units = [...seed.matchAll(/\('[^']+', '[^']+', '([^']+)', \d+, \d+, \d+\)/g)].map(
      (m) => m[1],
    );
    expect(units.length).toBe(60);
    expect(units).not.toContain('كيلو');
    expect(units.filter((u) => u === HALF_KILO_UNIT).length).toBeGreaterThan(0);
  });
});
