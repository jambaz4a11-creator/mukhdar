import { describe, expect, it } from 'vitest';
import { stripCount, titleWithCount } from './tabTitle';
import { readSoundEnabled, SOUND_KEY, writeSoundEnabled } from './soundPref';

describe('titleWithCount', () => {
  it('prefixes the count of new orders, and nothing at 0', () => {
    expect(titleWithCount('الطلبات · لوحة المخضر', 3)).toBe('(3) الطلبات · لوحة المخضر');
    expect(titleWithCount('لوحة المخضر', 0)).toBe('لوحة المخضر');
    expect(titleWithCount('لوحة المخضر', -1)).toBe('لوحة المخضر');
    expect(titleWithCount('لوحة المخضر', Number.NaN)).toBe('لوحة المخضر');
  });
  it('replaces an older prefix instead of stacking, caps at 99+', () => {
    expect(titleWithCount('(2) لوحة المخضر', 5)).toBe('(5) لوحة المخضر');
    expect(titleWithCount('(99+) لوحة المخضر', 0)).toBe('لوحة المخضر');
    expect(titleWithCount('لوحة المخضر', 250)).toBe('(99+) لوحة المخضر');
    expect(stripCount('(12) الطلبات')).toBe('الطلبات');
    expect(stripCount('(طلب) نص')).toBe('(طلب) نص');
  });
});

describe('sound preference', () => {
  const mem = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      m,
    };
  };
  it('defaults to on; off only when this device turned it off', () => {
    const s = mem();
    expect(readSoundEnabled(s)).toBe(true);
    writeSoundEnabled(s, false);
    expect(s.m.get(SOUND_KEY)).toBe('off');
    expect(readSoundEnabled(s)).toBe(false);
    writeSoundEnabled(s, true);
    expect(readSoundEnabled(s)).toBe(true);
  });
  it('blocked storage never throws and keeps the sound on', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readSoundEnabled(broken)).toBe(true);
    expect(() => writeSoundEnabled(broken, false)).not.toThrow();
    expect(readSoundEnabled(null)).toBe(true);
  });
});
