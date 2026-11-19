import fs from 'node:fs';
import path from 'node:path';
import {
  floorOptionLabel,
  formatAddress,
  formatAddressShort,
  formatFloor,
  formatSector,
  isValidApartment,
  isValidFloor,
} from '../address';

const snapshot = {
  address_id: 'a',
  sector: 'قطاع A',
  subsection: 'A3',
  building: '12',
  apartment: '5',
  note: null,
};

describe('formatAddress', () => {
  it('full address with the words for block, building and apartment', () => {
    expect(formatAddress(snapshot)).toBe('بلوك A3 · بناية 12 · شقة 5');
  });

  it('drops empty parts; the sector is part of the block name, not printed', () => {
    expect(formatSector('B')).toBe('قطاع B');
    expect(formatSector(' قطاع B ')).toBe('قطاع B');
    expect(formatAddress({ sector: 'B', subsection: 'B8', building: '100', apartment: ' ' })).toBe(
      'بلوك B8 · بناية 100',
    );
  });

  it('shows the floor between building and apartment (2026-11-18); ground floor as G', () => {
    expect(formatAddress({ ...snapshot, floor: 3 })).toBe('بلوك A3 · بناية 12 · الطابق 3 · شقة 5');
    expect(formatAddress({ ...snapshot, floor: 0 })).toBe('بلوك A3 · بناية 12 · الطابق G · شقة 5');
    expect(formatAddress({ ...snapshot, floor: 0, apartment: '4' })).toBe(
      'بلوك A3 · بناية 12 · الطابق G · شقة 4',
    );
    expect(formatAddress({ ...snapshot, floor: 0 })).not.toContain('الأرضي');
    expect(formatAddress({ ...snapshot, floor: null })).toBe('بلوك A3 · بناية 12 · شقة 5');
    expect(formatFloor(-1)).toBe('');
    expect(formatFloor(2.5)).toBe('');
  });

  it('short form matches the push text written by the database', () => {
    expect(formatAddressShort(snapshot)).toBe('بلوك A3 - بناية 12');
    // نفس الصيغة بـ SQL (آخر migration تعرّف نص الإشعار)
    const dir = path.resolve(__dirname, '../../../../supabase/migrations');
    const sql = fs.readFileSync(path.join(dir, '20261205000001_address_wording_block.sql'), 'utf8');
    expect(sql).toContain("'''بلوك '' ||'");
    expect(sql).toContain("'|| '' - بناية '' ||'");
  });
});

describe('Bismayah ranges (2026-11-19)', () => {
  it('floor: G (0) and 1..9 only', () => {
    for (const f of [0, 1, 5, 9]) expect(isValidFloor(f)).toBe(true);
    for (const f of [-1, 10, 20, 2.5, null, undefined, NaN]) expect(isValidFloor(f)).toBe(false);
    expect(floorOptionLabel(0)).toBe('G');
    expect(floorOptionLabel(7)).toBe('7');
    expect(formatFloor(0)).toBe('الطابق G');
    // طابق قديم فوق 9 يبقى يُعرض كما هو بطلباته القديمة
    expect(formatFloor(15)).toBe('الطابق 15');
  });

  it('apartment: 1..12, latin digits, no free text', () => {
    for (const a of ['1', '9', '10', '12', ' 4 ']) expect(isValidApartment(a)).toBe(true);
    for (const a of ['0', '13', '39', '01', 'ا', '٥', '5أ', '', null, undefined]) {
      expect(isValidApartment(a)).toBe(false);
    }
  });
});
