'use client';
// نوافذ الرمز (SPEC-admin §2.6، ADR 0001): إعادة ضبط PIN مستخدم، وإنشاء حساب موظف أو سائق.
// الرمز يُولَّد أو يُكتب بالمتصفح (validatePin)، يُرسل للدالة مرة، ويظهر **مرة واحدة** بعد النجاح
// مع نسخ ورابط wa.me. لا يُخزن بأي مكان (الحالة تُمسح بإغلاق النافذة).
import {
  PIN_MESSAGES,
  errorMessage,
  generatePin,
  normalizePin,
  validatePin,
  whatsappPinLink,
  normalizeIraqiPhone,
} from '@mukhdar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { displayPhone } from '@/features/orders/format';
import { Field, Modal, inputClass } from '@/features/catalog/ui';
import { adminKeys, createStaffUser, resetPin, type UserRow } from './api';
import { ROLE_LABELS, pinMessage, resetPinFailure } from './forms';

function PinInput({
  id,
  value,
  onChange,
  error,
  phone,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | undefined;
  phone: string | undefined;
}) {
  return (
    <Field
      label="الرمز (6 أرقام)"
      htmlFor={id}
      error={error}
      hint="بلا تكرار أو تسلسل، وليس من رقم الهاتف"
    >
      <div className="flex gap-2">
        <input
          id={id}
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          className={`${inputClass} num tracking-[0.3em]`}
          value={value}
          onChange={(e) => onChange(normalizePin(e.target.value))}
        />
        <button
          type="button"
          onClick={() => onChange(generatePin(phone))}
          className="h-11 shrink-0 rounded-control border border-border px-3 text-sm"
        >
          رمز عشوائي
        </button>
      </div>
    </Field>
  );
}

/** الرمز مرة واحدة: نسخ + واتساب. */
function PinOnce({
  pin,
  phone,
  message,
  onDone,
}: {
  pin: string;
  phone: string;
  message: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const wa = whatsappPinLink(phone, message);
  return (
    <div className="flex flex-col gap-3" data-testid="pin-once">
      <p className="m-0 text-sm text-text-muted">
        هذا الرمز يظهر <strong>مرة وحدة</strong> وما ينحفظ بأي مكان. الأفضل «نسخ الرمز» ثم الصقه
        بنفس المحادثة (رابط الواتساب يترك الرمز بسجل المتصفح).
      </p>
      <output
        data-testid="pin-value"
        className="num rounded-control bg-primary-soft py-3 text-center text-[28px] font-bold tracking-[0.3em] text-primary"
        dir="ltr"
      >
        {pin}
      </output>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(pin).then(() => setCopied(true));
          }}
          className="h-11 flex-1 rounded-control border border-border px-3 text-sm font-semibold"
        >
          {copied ? 'انتسخ ✓' : 'نسخ الرمز'}
        </button>
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            data-testid="pin-whatsapp"
            className="flex h-11 flex-1 items-center justify-center rounded-control bg-primary px-3 text-sm font-bold text-white no-underline hover:text-white"
          >
            إرسال بالواتساب
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={onDone}
        className="h-11 rounded-control border border-border text-sm"
      >
        تم، أغلق
      </button>
    </div>
  );
}

export function ResetPinDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const { supabase } = usePanel();
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | undefined>();
  const [done, setDone] = useState<string | null>(null);
  const phone = user.phone ?? undefined;

  const reset = useMutation({
    mutationFn: async () => {
      const err = validatePin(pin, phone);
      setPinError(err ? PIN_MESSAGES[err] : undefined);
      if (err) return null;
      await resetPin(supabase, user.id, pin);
      return pin;
    },
    onSuccess: (p) => {
      if (p) {
        setDone(p);
        setPin('');
      }
    },
    // فشل لا نعرف نتيجته ← قد يكون الرمز تغيّر بلا علامة: يُمسح الحقل فلا يُرسل (M2)
    onError: (e) => {
      if (resetPinFailure(e).clearPin) setPin('');
    },
  });

  const close = () => {
    setDone(null);
    onClose();
  };

  return (
    <Modal title="إعادة ضبط رمز الدخول" onClose={close} testId="reset-pin-dialog">
      {done ? (
        <PinOnce
          pin={done}
          phone={user.phone ?? ''}
          message={pinMessage('reset', done)}
          onDone={close}
        />
      ) : (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <p className="m-0 text-[15px] font-semibold">
            {user.full_name ?? 'بلا اسم'} ·{' '}
            <span className="num" dir="ltr">
              {displayPhone(user.phone)}
            </span>
          </p>
          <div
            role="note"
            data-testid="reset-rules"
            className="flex flex-col gap-1.5 rounded-control bg-warning-soft px-3 py-2 text-sm text-warning-text"
          >
            <strong>قبل الضبط (دليل التشغيل §16):</strong>
            <ul className="m-0 flex list-disc flex-col gap-1 ps-5 leading-6">
              <li>
                الرسالة لازم تجي من نفس الرقم المسجّل{' '}
                <span className="num font-bold" dir="ltr">
                  {displayPhone(user.phone)}
                </span>{' '}
                (رقم رأس المحادثة، مو الاسم ولا رسالة محوّلة ولا لقطة شاشة).
              </li>
              {user.role === 'customer' ? (
                <li>
                  اسأله سؤالين عن آخر طلب له: <strong>المبلغ التقريبي</strong> و
                  <strong>العنوان</strong>. إن غلط بواحد لا تضبط.
                </li>
              ) : (
                <li>
                  {ROLE_LABELS[user.role]}: لا تضبط من رسالة وحدها،{' '}
                  <strong>اتصل بالرقم المسجّل</strong> وتأكد منه بالمكالمة أولاً.
                </li>
              )}
              <li>
                «رقم جديد» ليس سبباً للضبط: حساب جديد، أو تغيير الرقم بعد تحقق مباشر. وحساب الأدمن
                لا يُضبط من واتساب أبداً.
              </li>
              <li>الضبط يطلّعه من كل الأجهزة؛ أبلغه بذلك، وإن ما طلبه بنفسه عطّل الحساب.</li>
            </ul>
          </div>
          <PinInput id="reset-pin" value={pin} onChange={setPin} error={pinError} phone={phone} />
          {reset.error && (
            <p
              role="alert"
              className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              {resetPinFailure(reset.error).message}
            </p>
          )}
          <button
            type="submit"
            disabled={reset.isPending}
            className="h-12 rounded-control bg-primary text-[15px] font-bold text-white disabled:opacity-60"
          >
            {reset.isPending ? 'جارٍ الضبط…' : 'ضبط الرمز الجديد'}
          </button>
        </form>
      )}
    </Modal>
  );
}

export function CreateUserDialog({
  onClose,
  onPromote,
}: {
  onClose: () => void;
  /** الرقم مسجّل: فتح الترقية بدل الإنشاء. */
  onPromote: (phone: string) => void;
}) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'staff' | 'driver'>('driver');
  const [pin, setPin] = useState('');
  const [errors, setErrors] = useState<{ phone?: string; name?: string; pin?: string }>({});
  const [done, setDone] = useState<{ pin: string; phone: string } | null>(null);
  const e164 = normalizeIraqiPhone(phone);

  const create = useMutation({
    mutationFn: async () => {
      const next: typeof errors = {};
      if (!e164) next.phone = 'رقم موبايل عراقي يبدأ بـ 07';
      const trimmed = name.trim();
      if (!trimmed || trimmed.length > 80)
        next.name = trimmed ? 'الاسم أطول من 80 حرف' : 'اكتب الاسم';
      const pinErr = validatePin(pin, e164 ?? undefined);
      if (pinErr) next.pin = PIN_MESSAGES[pinErr];
      setErrors(next);
      if (Object.keys(next).length > 0 || !e164) return null;
      await createStaffUser(supabase, { phone: e164, full_name: trimmed, role, pin });
      return { pin, phone: e164 };
    },
    onSuccess: async (r) => {
      if (!r) return;
      setDone(r);
      setPin('');
      await qc.invalidateQueries({ queryKey: adminKeys.staff });
    },
  });
  const taken = (create.error as { code?: string } | null)?.code === 'PHONE_TAKEN';

  const close = () => {
    setDone(null);
    onClose();
  };

  return (
    <Modal title="إضافة موظف أو سائق" onClose={close} testId="create-user-dialog">
      {done ? (
        <PinOnce
          pin={done.pin}
          phone={done.phone}
          message={pinMessage('create', done.pin)}
          onDone={close}
        />
      ) : (
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="رقم الهاتف" htmlFor="cu-phone" error={errors.phone}>
            <input
              id="cu-phone"
              inputMode="tel"
              dir="ltr"
              placeholder="07XXXXXXXXX"
              className={`${inputClass} num text-right`}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <Field label="الاسم" htmlFor="cu-name" error={errors.name}>
            <input
              id="cu-name"
              maxLength={80}
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <fieldset className="m-0 flex gap-2 border-0 p-0">
            <legend className="mb-1 text-[13px] font-semibold">الدور</legend>
            {(['driver', 'staff'] as const).map((r) => (
              <label
                key={r}
                className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-control border text-sm ${
                  role === r
                    ? 'border-primary bg-primary-soft font-bold text-primary'
                    : 'border-border'
                }`}
              >
                <input
                  type="radio"
                  name="cu-role"
                  value={r}
                  checked={role === r}
                  onChange={() => setRole(r)}
                  className="accent-primary"
                />
                {r === 'driver' ? 'سائق' : 'موظف'}
              </label>
            ))}
          </fieldset>
          <PinInput
            id="cu-pin"
            value={pin}
            onChange={setPin}
            error={errors.pin}
            phone={e164 ?? undefined}
          />
          {create.error && (
            <div
              role="alert"
              className="flex flex-col gap-2 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              <span>
                {taken ? 'الرقم مسجّل. رقّه بدل ما تسوي حساب ثاني.' : errorMessage(create.error)}
              </span>
              {taken && e164 && (
                <button
                  type="button"
                  onClick={() => onPromote(e164)}
                  className="h-10 rounded-control border border-danger bg-surface text-sm font-semibold text-danger"
                >
                  ترقية هذا الرقم
                </button>
              )}
            </div>
          )}
          <button
            type="submit"
            disabled={create.isPending}
            className="h-12 rounded-control bg-primary text-[15px] font-bold text-white disabled:opacity-60"
          >
            {create.isPending ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}
          </button>
        </form>
      )}
    </Modal>
  );
}
