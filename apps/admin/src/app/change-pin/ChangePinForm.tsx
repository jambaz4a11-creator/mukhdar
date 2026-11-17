'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { signOut } from '@/app/actions';
import { changePanelPin } from '@/features/account/changePin';
import { createClient } from '@/lib/supabase/browser';

export function ChangePinForm({ phone, forced }: { phone: string | null; forced: boolean }) {
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [totp, setTotp] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await changePanelPin(createClient(), phone, current, totp, next, confirm);
    setBusy(false);
    if (!result.ok) {
      if (result.field === 'current') setCurrent('');
      if (result.field === 'totp' || result.field === 'current') setTotp('');
      setError(result.message);
      return;
    }
    setCurrent('');
    setTotp('');
    setNext('');
    setConfirm('');
    setDone(true);
    router.replace('/');
    router.refresh();
  }

  const input =
    'num h-12 w-full rounded-input border border-border bg-surface px-4 text-right text-base tracking-[0.4em] outline-none focus:border-primary';
  const field = (
    id: string,
    label: string,
    value: string,
    set: (v: string) => void,
    auto: string,
    type: 'password' | 'text' = 'password',
  ) => (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <input
        id={id}
        type={type}
        inputMode="numeric"
        autoComplete={auto}
        dir="ltr"
        maxLength={6}
        className={input}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setError(null);
        }}
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {field(
          'pin-current',
          forced ? 'الرمز المؤقت' : 'الرمز الحالي',
          current,
          setCurrent,
          'current-password',
        )}
        {field('pin-totp', 'رمز تطبيق المصادقة', totp, setTotp, 'one-time-code', 'text')}
        {field('pin-new', 'الرمز الجديد', next, setNext, 'new-password')}
        {field('pin-confirm', 'أعد كتابة الرمز الجديد', confirm, setConfirm, 'new-password')}
        {error && (
          <p
            role="alert"
            data-testid="pin-error"
            className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
        {done && (
          <p role="status" data-testid="pin-changed" className="text-sm text-primary">
            تم تغيير الرمز.
          </p>
        )}
        <button
          type="submit"
          disabled={
            busy || current.length < 6 || totp.length < 6 || next.length < 6 || confirm.length < 6
          }
          className="h-14 rounded-card bg-primary text-base font-bold text-white hover:bg-primary-pressed disabled:opacity-60"
        >
          {busy ? 'جارٍ التغيير…' : 'تغيير الرمز'}
        </button>
      </form>
      {forced ? (
        <form action={signOut} className="text-center">
          <button type="submit" className="min-h-11 text-sm text-danger">
            تسجيل الخروج
          </button>
        </form>
      ) : (
        <a href="/" className="text-center text-sm text-text-muted">
          رجوع
        </a>
      )}
    </div>
  );
}
