import { describe, expect, it } from 'vitest';
import { stripCount, titleWithCount } from './tabTitle';
import { readSoundEnabled, SOUND_KEY, writeSoundEnabled } from './soundPref';

describe('titleWithCount', () => {
  it('prefixes the count of new orders, and nothing at 0', () => {
    expect(titleWithCount('الطلبات · لوحة سوق بسماوي', 3)).toBe('(3) الطلبات · لوحة سوق بسماوي');
    expect(titleWithCount('لوحة سوق بسماوي', 0)).toBe('لوحة سوق بسماوي');
    expect(titleWithCount('لوحة سوق بسماوي', -1)).toBe('لوحة سوق بسماوي');
    expect(titleWithCount('لوحة سوق بسماوي', Number.NaN)).toBe('لوحة سوق بسماوي');
  });
  it('replaces an older prefix instead of stacking, caps at 99+', () => {
    expect(titleWithCount('(2) لوحة سوق بسماوي', 5)).toBe('(5) لوحة سوق بسماوي');
    expect(titleWithCount('(99+) لوحة سوق بسماوي', 0)).toBe('لوحة سوق بسماوي');
    expect(titleWithCount('لوحة سوق بسماوي', 250)).toBe('(99+) لوحة سوق بسماوي');
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
