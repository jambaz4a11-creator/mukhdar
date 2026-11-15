'use client';
import { PIN_MESSAGES, authError, phonePinCredentials, normalizeIraqiPhone } from '@mukhdar/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/browser';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!normalizeIraqiPhone(phone)) return setError('رقم الهاتف غير صحيح (07XXXXXXXXX)');
    const creds = phonePinCredentials(phone, pin);
    if (!creds) return setError(PIN_MESSAGES.PIN_LENGTH);
    setBusy(true);
    try {
      const { error: err } = await createClient().auth.signInWithPassword(creds);
      if (err) {
        setError(authError(err).message);
        return;
      }
      // الـ proxy يقرر: الرئيسية للأدمن والموظف، "غير مصرح" لغيرهم.
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(authError(err).message);
    } finally {
      setBusy(false);
    }
  }

  const input =
    'num h-12 w-full rounded-input border border-border bg-surface px-4 text-base outline-none focus:border-primary';
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        رقم الهاتف
        <input
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="username"
          dir="ltr"
          placeholder="07XXXXXXXXX"
          className={`${input} text-right`}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        رمز الدخول (PIN)
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          dir="ltr"
          maxLength={6}
          className={`${input} text-right tracking-[0.4em]`}
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </label>
      {error && (
        <p
          role="alert"
          data-testid="login-error"
          className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="h-14 rounded-card bg-primary text-base font-bold text-white hover:bg-primary-pressed disabled:opacity-60"
      >
        {busy ? 'جارٍ الدخول…' : 'دخول'}
      </button>
    </form>
  );
}
