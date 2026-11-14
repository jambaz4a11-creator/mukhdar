import fs from 'node:fs';
import path from 'node:path';
import { formatAddress, formatAddressShort, formatSector } from '../address';

const snapshot = {
  address_id: 'a',
  sector: 'قطاع A',
  subsection: 'A3',
  building: '12',
  apartment: '5',
  note: null,
};

describe('formatAddress', () => {
  it('full address with the words for unit, building and apartment', () => {
    expect(formatAddress(snapshot)).toBe('قطاع A · وحدة A3 · عمارة 12 · شقة 5');
  });

  it('adds the sector word only when missing, and drops empty parts', () => {
    expect(formatSector('B')).toBe('قطاع B');
    expect(formatSector(' قطاع B ')).toBe('قطاع B');
    expect(formatAddress({ sector: 'B', subsection: 'B8', building: '100', apartment: ' ' })).toBe(
      'قطاع B · وحدة B8 · عمارة 100',
    );
  });

  it('short form matches the push text written by the database', () => {
    expect(formatAddressShort(snapshot)).toBe('وحدة A3 - عمارة 12');
    // نفس الصيغة بـ SQL (آخر migration تعرّف نص الإشعار)
    const dir = path.resolve(__dirname, '../../../../supabase/migrations');
    const sql = fs.readFileSync(path.join(dir, '20261115000002_ready_flow.sql'), 'utf8');
    expect(sql).toContain(
      "'وحدة ' || (v_order.address_snapshot ->> 'subsection') || ' - عمارة ' || (v_order.address_snapshot ->> 'building')",
    );
  });
});
