import fs from 'node:fs';
import path from 'node:path';
import { formatAddress, formatAddressShort, formatFloor, formatSector } from '../address';

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

  it('shows the floor between building and apartment (2026-11-18); ground floor by name', () => {
    expect(formatAddress({ ...snapshot, floor: 3 })).toBe('بلوك A3 · بناية 12 · الطابق 3 · شقة 5');
    expect(formatAddress({ ...snapshot, floor: 0 })).toBe(
      'بلوك A3 · بناية 12 · الطابق الأرضي · شقة 5',
    );
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
