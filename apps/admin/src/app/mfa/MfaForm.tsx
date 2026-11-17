'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/app/actions';
import { type EnrollResult, startTotpEnrollment, verifyTotp } from '@/features/account/mfa';
import { createClient } from '@/lib/supabase/browser';

type Enrollment = { factorId: string; qrCode: string; secret: string };

/** enrolled = عنده عامل مُفعَّل (يُطلب الرمز فقط)؛ وإلا التسجيل أولاً (QR + المفتاح اليدوي). */
export function MfaForm({ enrolled, next }: { enrolled: boolean; next: string }) {
  const router = useRouter();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // تسجيل واحد فقط حتى لو نُفذ الـ effect مرتين (Strict Mode): محاولتان متوازيتان تتصادمان بنفس الاسم
  const started = useRef<Promise<EnrollResult> | null>(null);

  useEffect(() => {
    if (enrolled) return;
    let alive = true;
    started.current ??= startTotpEnrollment(createClient());
    void started.current.then((r) => {
      if (!alive) return;
      if (r.ok) setEnrollment(r);
      else setError(r.message);
    });
    return () => {
      alive = false;
    };
  }, [enrolled]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await verifyTotp(
      createClient(),
      enrolled ? null : (enrollment?.factorId ?? null),
      code,
    );
    setBusy(false);
    if (!r.ok) {
      setCode('');
      setError(r.message);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  const ready = enrolled || enrollment !== null;

  return (
    <div className="flex flex-col gap-4">
      {!enrolled && enrollment && (
        <div className="flex flex-col items-center gap-3">
          {/* SVG من Auth كـ data URL: لا طلب خارجي ولا مكتبة QR */}
          <img
            src={enrollment.qrCode}
            alt="رمز QR لتطبيق المصادقة"
            width={192}
            height={192}
            data-testid="mfa-qr"
            className="rounded-control bg-white p-2"
          />
          <div className="w-full text-sm">
            <span className="text-text-muted">أو المفتاح اليدوي:</span>
            <code
              dir="ltr"
              data-testid="mfa-secret"
              className="num mt-1 block select-all break-all rounded-control bg-background px-3 py-2 text-center tracking-wider"
            >
              {enrollment.secret}
            </code>
          </div>
        </div>
      )}
      {!enrolled && !enrollment && !error && (
        <p className="text-sm text-text-muted">جارٍ التجهيز…</p>
      )}
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <label htmlFor="mfa-code" className="flex flex-col gap-1.5 text-sm font-medium">
          رمز تطبيق المصادقة
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            maxLength={6}
            autoFocus
            className="num h-12 w-full rounded-input border border-border bg-surface px-4 text-center text-base tracking-[0.4em] outline-none focus:border-primary"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setError(null);
            }}
          />
        </label>
        {error && (
          <p
            role="alert"
            data-testid="mfa-error"
            className="rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !ready || code.length < 6}
          className="h-14 rounded-card bg-primary text-base font-bold text-white hover:bg-primary-pressed disabled:opacity-60"
        >
          {busy ? 'جارٍ التحقق…' : enrolled ? 'دخول' : 'تفعيل ودخول'}
        </button>
      </form>
      <form action={signOut} className="text-center">
        <button type="submit" className="min-h-11 text-sm text-danger">
          تسجيل الخروج
        </button>
      </form>
    </div>
  );
}
