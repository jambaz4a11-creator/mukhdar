'use client';
// شريط "فعّل الصوت" (T44، SPEC-admin-push §5): المتصفح يمنع الصوت حتى أول تفاعل، فما دام مقفولاً والصوت مطلوب لهذا
// الجهاز نقولها بوضوح مع زر. يختفي عند أي نقرة تفتح الصوت، أو إطفاء الصوت من "تنبيهات هذا الجهاز".
import { playTestSound } from '@/lib/sound';
import { UNLOCK_BANNER, UNLOCK_BUTTON } from './text';
import { useAudioUnlocked, useSoundEnabled } from './useSoundPref';

export function SoundUnlockBanner() {
  const [enabled] = useSoundEnabled();
  const unlocked = useAudioUnlocked();
  if (!enabled || unlocked !== false) return null;
  return (
    <div
      role="status"
      data-testid="sound-unlock-banner"
      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-warning-soft px-4 py-3 text-warning-text"
    >
      <span className="flex items-center gap-2 text-[15px]">
        <span aria-hidden="true">🔇</span>
        {UNLOCK_BANNER}
      </span>
      <button
        type="button"
        onClick={() => void playTestSound()}
        className="min-h-11 rounded-control bg-primary px-4 text-[15px] font-semibold text-white hover:bg-primary-pressed"
      >
        {UNLOCK_BUTTON}
      </button>
    </div>
  );
}
