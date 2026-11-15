// صوت تنبيه الطلب الجديد بـ Web Audio (نغمتان قصيرتان، بلا ملف صوتي). المتصفح يمنع الصوت قبل أول تفاعل،
// لذا يُفتح السياق عند أول نقرة أو ضغطة زر (unlockAudio).
let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

export function unlockAudio(): void {
  void context()?.resume();
}

/** عدد التنبيهات بهذه الصفحة (data-new-order-alerts على <html>)، لاختبارات Playwright. */
function countAlert(): void {
  const el = document.documentElement;
  el.dataset.newOrderAlerts = String(Number(el.dataset.newOrderAlerts ?? '0') + 1);
}

export function playNewOrderSound(): void {
  if (typeof window === 'undefined') return;
  countAlert();
  const ac = context();
  if (!ac || ac.state !== 'running') return;
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
