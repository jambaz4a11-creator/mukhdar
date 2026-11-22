'use client';
// قسم "أجرة التوصيل وتسليم الكاش" بصفحة الإعدادات (أدمن فقط، SPEC-cash K19 و§4، SPEC-admin §2.10): خياران
// بشرح عربي وتنبيه ثابت. الحفظ عبر update_app_settings بمفتاحه وحده (مُدقَّق)، وبعده تتحدث أرصدة الكاش.
import { errorMessage } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { cashKeys, fetchFeeSetting, saveFeeSetting } from './api';
import { FEE_OPTIONS, FEE_SECTION_TITLE, FEE_WARNING } from './feeSetting';

const cardClass = 'flex flex-col gap-3.5 rounded-card border border-border bg-surface p-[18px]';

export function FeeSettingsCard() {
  const { supabase } = usePanel();
  const current = useQuery({
    queryKey: cashKeys.feeSetting,
    queryFn: () => fetchFeeSetting(supabase),
  });
  return (
    <section aria-label={FEE_SECTION_TITLE} className={cardClass} data-testid="fee-setting">
      <h2 className="m-0 text-[17px] font-bold">{FEE_SECTION_TITLE}</h2>
      {current.data === undefined ? (
        <p className="m-0 text-sm text-text-muted">
          {current.error ? errorMessage(current.error) : 'جارٍ التحميل…'}
        </p>
      ) : (
        // بلا key: بعد الحفظ يُعاد الجلب والنموذج يبقى مع رسالة "انحفظ"
        <FeeForm saved={current.data} />
      )}
    </section>
  );
}

function FeeForm({ saved }: { saved: boolean }) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const [value, setValue] = useState(saved);
  const [done, setDone] = useState(false);
  const save = useMutation({
    mutationFn: () => saveFeeSetting(supabase, value),
    onSuccess: async () => {
      setDone(true);
      await qc.invalidateQueries({ queryKey: cashKeys.all });
    },
  });
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="sr-only">{FEE_SECTION_TITLE}</legend>
        {FEE_OPTIONS.map((o) => (
          <label
            key={String(o.value)}
            className={`flex cursor-pointer items-start gap-3 rounded-control border px-3.5 py-3 ${
              value === o.value ? 'border-primary bg-primary-soft' : 'border-border bg-surface'
            }`}
          >
            <input
              type="radio"
              name="cash-fee-basis"
              checked={value === o.value}
              onChange={() => {
                setValue(o.value);
                setDone(false);
              }}
              className="mt-1 h-5 w-5 shrink-0 accent-primary"
            />
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-bold">{o.label}</span>
              <span className="text-[13px] text-text-muted">{o.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p
        className="m-0 rounded-control bg-warning-soft px-3 py-2 text-[13px] text-warning-text"
        data-testid="fee-warning"
      >
        {FEE_WARNING}
      </p>
      {save.error && (
        <p
          role="alert"
          className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {errorMessage(save.error)}
        </p>
      )}
      {done && !save.error && (
        <p
          role="status"
          data-testid="fee-saved"
          className="m-0 rounded-control bg-primary-soft px-3 py-2 text-sm text-primary"
        >
          انحفظ الإعداد
        </p>
      )}
      <button
        type="submit"
        data-testid="fee-save"
        disabled={save.isPending || value === saved}
        className="h-12 rounded-control bg-primary text-[15px] font-bold text-white disabled:opacity-60"
      >
        {save.isPending ? 'جارٍ الحفظ…' : 'حفظ الإعداد'}
      </button>
    </form>
  );
}
