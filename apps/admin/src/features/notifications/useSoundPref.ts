'use client';
// إعداد الصوت لهذا الجهاز وحالة فتح الصوت بالمتصفح، مشتركان بين "تنبيهات هذا الجهاز" وشريط "فعّل الصوت" (T44).
import { useCallback, useEffect, useState } from 'react';
import { audioUnlocked, onAudioStateChange } from '@/lib/sound';
import { readSoundEnabled, writeSoundEnabled } from './soundPref';

const EVENT = 'mukhdar:sound-pref';

export function useSoundEnabled(): [boolean, (on: boolean) => void] {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    const sync = () => setEnabled(readSoundEnabled(window.localStorage));
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const set = useCallback((on: boolean) => {
    writeSoundEnabled(window.localStorage, on);
    setEnabled(on);
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [enabled, set];
}

/** null قبل التحميل أو بلا Web Audio؛ وإلا هل الصوت مفتوح بالمتصفح. */
export function useAudioUnlocked(): boolean | null {
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  useEffect(() => {
    const sync = () => setUnlocked(audioUnlocked());
    sync();
    const off = onAudioStateChange(sync);
    // أول نقرة بأي مكان تفتح الصوت (PanelProviders)؛ نعيد القراءة بعدها
    const later = () => setTimeout(sync, 50);
    window.addEventListener('pointerdown', later);
    window.addEventListener('keydown', later);
    return () => {
      off();
      window.removeEventListener('pointerdown', later);
      window.removeEventListener('keydown', later);
    };
  }, []);
  return unlocked;
}
