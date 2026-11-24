// صوت تنبيه الطلب الجديد بـ Web Audio (نغمتان قصيرتان، بلا ملف صوتي). المتصفح يمنع الصوت قبل أول تفاعل،
// لذا يُفتح السياق عند أول نقرة أو ضغطة زر (unlockAudio)، واللوحة تعرض زر "فعّل الصوت" ما دام مقفولاً (T44).
// إطفاء الصوت لكل جهاز (soundPref.ts) يمنع النغمة فقط؛ العدّاد data-new-order-alerts يبقى (Playwright).
import { readSoundEnabled } from '@/features/notifications/soundPref';

let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
    ctx.addEventListener?.('statechange', () => listeners.forEach((l) => l()));
  }
  return ctx;
}

/** يفتح السياق (من لمسة مستخدم). true إن صار الصوت يعمل. */
export async function unlockAudio(): Promise<boolean> {
  const ac = context();
  if (!ac) return false;
  try {
    await ac.resume();
  } catch {
    // يبقى مقفولاً
  }
  listeners.forEach((l) => l());
  return ac.state === 'running';
}

/** هل يعمل الصوت الآن؟ (null = المتصفح بلا Web Audio) */
export function audioUnlocked(): boolean | null {
  const ac = context();
  return ac ? ac.state === 'running' : null;
}

/** يُستدعى عند تغيّر حالة الصوت (فتح/قفل). يرجع دالة الإلغاء. */
export function onAudioStateChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** عدد التنبيهات بهذه الصفحة (data-new-order-alerts على <html>)، لاختبارات Playwright. */
function countAlert(): void {
  const el = document.documentElement;
  el.dataset.newOrderAlerts = String(Number(el.dataset.newOrderAlerts ?? '0') + 1);
}

function chime(ac: AudioContext): void {
  const now = ac.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.18;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.17);
  });
}

export function playNewOrderSound(): void {
  if (typeof window === 'undefined') return;
  countAlert();
  if (!readSoundEnabled(window.localStorage)) return;
  const ac = context();
  if (!ac || ac.state !== 'running') return;
  chime(ac);
}

/** زر "جرّب الصوت" و"فعّل الصوت": يفتح السياق ويشغّل النغمة مرة (حتى لو الصوت مطفأ: المستخدم طلبها). */
export async function playTestSound(): Promise<boolean> {
  const ok = await unlockAudio();
  const ac = context();
  if (ok && ac) chime(ac);
  return ok;
}
