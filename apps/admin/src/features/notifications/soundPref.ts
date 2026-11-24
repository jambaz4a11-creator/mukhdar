// إعداد الصوت لكل جهاز (T44، SPEC-admin-push §4، افتراض A7): localStorage (ليس سراً)، افتراضياً مفعّل.
export const SOUND_KEY = 'mukhdar.admin.sound';

type Readable = Pick<Storage, 'getItem'> | null | undefined;
type Writable = Pick<Storage, 'setItem'> | null | undefined;

export function readSoundEnabled(storage: Readable): boolean {
  try {
    return storage?.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true; // تخزين محجوب (وضع خاص): الافتراض مفعّل
  }
}

export function writeSoundEnabled(storage: Writable, enabled: boolean): void {
  try {
    storage?.setItem(SOUND_KEY, enabled ? 'on' : 'off');
  } catch {
    // لا شيء: يبقى للجلسة الحالية بحالة الواجهة
  }
}
