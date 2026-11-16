import { describe, expect, it } from 'vitest';
import type { Driver } from './api';
import { DRIVER_PIN_PENDING_LABEL, driverOptions } from './drivers';

const d = (id: string, over: Partial<Driver> = {}): Driver => ({
  id,
  full_name: `سائق ${id}`,
  phone: '9647700000000',
  is_active: true,
  must_change_pin: false,
  ...over,
});

describe('driverOptions', () => {
  it('hides inactive drivers and the current driver', () => {
    const out = driverOptions([d('a'), d('b', { is_active: false }), d('c')], 'c');
    expect(out.map((o) => o.id)).toEqual(['a']);
  });

  it('shows a driver with a pending PIN change, disabled and labelled', () => {
    const [opt] = driverOptions([d('a', { must_change_pin: true })], null);
    expect(opt?.disabled).toBe(true);
    expect(opt?.label).toContain(DRIVER_PIN_PENDING_LABEL);
  });

  it('keeps ready drivers selectable with a plain label', () => {
    const [opt] = driverOptions([d('a')], null);
    expect(opt).toEqual({ id: 'a', label: 'سائق a', disabled: false });
  });
});
