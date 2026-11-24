'use client';
// "تنبيهات هذا الجهاز" (T44، SPEC-admin-push §4): كل شخص يشغّل/يطفئ الإشعارات والصوت على جهازه. زر بأسفل القائمة
// الجانبية يفتح قسماً صغيراً. الإذن يُطلب من زر "شغّل" فقط، لا عند التحميل.
import { useCallback, useEffect, useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { playTestSound } from '@/lib/sound';
import {
  disableDevicePush,
  enableDevicePush,
  readDeviceAlertState,
  type DeviceAlertState,
} from './pushClient';
import {
  ALERTS_TITLE,
  DISABLE_LABEL,
  ENABLE_LABEL,
  SESSION_NOTE,
  SOUND_LABEL,
  TEST_SOUND_LABEL,
  deviceAlertCopy,
  enableResultMessage,
  whatArrives,
} from './text';
import { useSoundEnabled } from './useSoundPref';

export function DeviceAlerts() {
  const { supabase, role, pushVersion } = usePanel();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DeviceAlertState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useSoundEnabled();

  const refresh = useCallback(async () => {
    setState(await readDeviceAlertState(supabase));
  }, [supabase]);

  // عند التحميل، وبعد التسجيل الصامت (pushVersion)، وعند فتح القسم
  useEffect(() => {
    void refresh();
  }, [refresh, pushVersion, open]);

  const copy = state ? deviceAlertCopy(state) : null;

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(enableResultMessage(await enableDevicePush(supabase)));
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      await disableDevicePush(supabase);
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  const dot =
    copy?.tone === 'ok' ? 'bg-primary' : copy?.tone === 'warn' ? 'bg-star' : 'bg-text-muted';

  return (
    <div className="flex flex-col gap-2" data-testid="device-alerts">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="device-alerts-panel"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 items-center gap-2 rounded-control px-3 text-start text-[15px] text-text hover:bg-primary-soft"
      >
        <span aria-hidden="true">🔔</span>
        <span className="flex-1">{ALERTS_TITLE}</span>
        {copy && (
          <span
            className={`size-2.5 rounded-full ${dot}`}
            aria-label={copy.status}
            data-testid="device-alerts-dot"
            data-state={state ?? ''}
          />
        )}
      </button>

      {open && (
        <section
          id="device-alerts-panel"
          aria-label={ALERTS_TITLE}
          className="flex flex-col gap-3 rounded-card border border-border bg-background p-3 text-sm"
        >
          <div className="flex flex-col gap-2">
            <p
              className="font-semibold"
              data-testid="device-alerts-status"
              data-state={state ?? ''}
            >
              {copy?.status ?? '…'}
            </p>
            {copy?.help && <p className="text-text-muted">{copy.help}</p>}
            {copy?.action === 'enable' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void enable()}
                className="min-h-11 rounded-control bg-primary px-3 font-semibold text-white hover:bg-primary-pressed disabled:opacity-60"
              >
                {ENABLE_LABEL}
              </button>
            )}
            {copy?.action === 'disable' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void disable()}
                className="min-h-11 rounded-control border border-border bg-surface px-3 text-text hover:bg-primary-soft disabled:opacity-60"
              >
                {DISABLE_LABEL}
              </button>
            )}
            {message && (
              <p role="alert" className="text-danger">
                {message}
              </p>
            )}
            <p className="text-text-muted">{whatArrives(role)}</p>
            <p className="text-text-muted">{SESSION_NOTE}</p>
          </div>

          <div className="flex flex-col gap-2 border-t border-divider pt-3">
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                className="size-5 accent-primary"
                checked={soundOn}
                onChange={(e) => setSoundOn(e.target.checked)}
              />
              <span>{SOUND_LABEL}</span>
            </label>
            <button
              type="button"
              onClick={() => void playTestSound()}
              className="min-h-11 rounded-control border border-border bg-surface px-3 text-text hover:bg-primary-soft"
            >
              {TEST_SOUND_LABEL}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
