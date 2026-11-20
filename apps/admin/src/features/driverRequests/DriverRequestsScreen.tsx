'use client';
// طلبات السواق (T29، SPEC-admin §2.10، SPEC-driver §5): تبويبا "بانتظار الموافقة" و"آخر القرارات" (30 يوماً).
// الموافقة تتطلب خانة "اتصلت وتأكدت" (الأدمن يتصل بالرقم قبلها، RUNBOOK §16c)، والرفض بملاحظة اختيارية.
// القرار الفعلي والتدقيق بقاعدة البيانات (decide_driver_request)؛ هنا عرض فقط. الملاحظة نص صرف (React يهرّب).
import { errorMessage } from '@mukhdar/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { Field, Modal } from '@/features/catalog/ui';
import { displayPhone, formatDateTime, phoneLinks } from '@/features/orders/format';
import {
  decideDriverRequest,
  driverRequestsKeys,
  fetchDriverRequests,
  type DriverRequestRow,
  type DriverRequestTab,
} from './api';
import {
  NOTE_MAX,
  approveBlocked,
  canWithdraw,
  decisionErrorMessage,
  sinceLabel,
  statusLabel,
} from './format';

const POLL_MS = 60_000;
const TABS: { id: DriverRequestTab; label: string }[] = [
  { id: 'pending', label: 'بانتظار الموافقة' },
  { id: 'decided', label: 'آخر القرارات' },
];

type Decision = { kind: 'approve' | 'reject' | 'withdraw'; row: DriverRequestRow };

export function DriverRequestsScreen() {
  const { supabase } = usePanel();
  const [tab, setTab] = useState<DriverRequestTab>('pending');
  const [decision, setDecision] = useState<Decision | null>(null);
  const list = useQuery({
    queryKey: driverRequestsKeys.list(tab),
    queryFn: () => fetchDriverRequests(supabase, tab),
    refetchInterval: POLL_MS,
  });
  const rows = list.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-0.5">
        <h1 className="m-0 text-[26px] font-bold">طلبات السواق</h1>
        <span className="text-sm text-text-muted">
          اتصل بالرقم وتأكد من الاسم قبل الموافقة. الموافقة صالحة 7 أيام ليختار السائق رمزه من نفس
          جهازه.
        </span>
      </header>

      <div role="tablist" aria-label="طلبات السواق" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="driver-requests-panel"
            onClick={() => setTab(t.id)}
            className={`h-10 rounded-full border px-4 text-sm ${
              tab === t.id
                ? 'border-primary bg-primary font-semibold text-white'
                : 'border-border bg-surface'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section
        id="driver-requests-panel"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="flex flex-col rounded-card border border-border bg-surface px-[18px] py-2"
        data-testid="driver-requests-list"
      >
        {list.isPending && <p className="text-sm text-text-muted">جارٍ التحميل…</p>}
        {list.error && (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(list.error)}
          </p>
        )}
        {list.isSuccess && rows.length === 0 && (
          <p className="text-sm text-text-muted" data-testid="driver-requests-empty">
            {tab === 'pending' ? 'ماكو طلبات بانتظار الموافقة' : 'ماكو قرارات خلال آخر 30 يوماً'}
          </p>
        )}
        {rows.map((r, i) => (
          <RequestLine
            key={r.id}
            row={r}
            tab={tab}
            first={i === 0}
            onApprove={() => setDecision({ kind: 'approve', row: r })}
            onReject={() => setDecision({ kind: 'reject', row: r })}
            onWithdraw={() => setDecision({ kind: 'withdraw', row: r })}
          />
        ))}
      </section>

      {decision?.kind === 'approve' && (
        <ApproveDialog row={decision.row} onClose={() => setDecision(null)} />
      )}
      {decision?.kind === 'reject' && (
        <RejectDialog row={decision.row} onClose={() => setDecision(null)} />
      )}
      {decision?.kind === 'withdraw' && (
        <RejectDialog withdraw row={decision.row} onClose={() => setDecision(null)} />
      )}
    </div>
  );
}

function RequestLine({
  row,
  tab,
  first,
  onApprove,
  onReject,
  onWithdraw,
}: {
  row: DriverRequestRow;
  tab: DriverRequestTab;
  first: boolean;
  onApprove: () => void;
  onReject: () => void;
  onWithdraw: () => void;
}) {
  const phone = displayPhone(row.phone);
  const links = phoneLinks(row.phone);
  const [copied, setCopied] = useState(false);
  return (
    <article
      data-request-phone={phone}
      data-request-status={row.status}
      className={`flex flex-wrap items-center gap-2.5 py-3 ${first ? '' : 'border-t border-divider'}`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-soft font-bold text-primary">
        {row.full_name.charAt(0)}
      </span>
      <span className="flex min-w-[160px] flex-1 flex-col">
        <span className="text-[15px] font-semibold">{row.full_name}</span>
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-text-muted">
          <span className="num" dir="ltr">
            {phone}
          </span>
          <span>{sinceLabel(row.created_at)}</span>
        </span>
      </span>

      <span className="flex gap-2">
        {links && (
          <a
            href={links.tel}
            className="flex h-10 items-center rounded-[10px] border border-border bg-surface px-2.5 text-[13px] text-text no-underline"
          >
            اتصال
          </a>
        )}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(phone).then(() => setCopied(true));
          }}
          className="h-10 rounded-[10px] border border-border bg-surface px-2.5 text-[13px]"
        >
          {copied ? 'انتسخ ✓' : 'نسخ الرقم'}
        </button>
      </span>

      {tab === 'pending' ? (
        <span className="flex gap-2">
          <button
            type="button"
            onClick={onApprove}
            className="h-10 rounded-[10px] bg-primary px-4 text-[13px] font-bold text-white"
          >
            موافقة
          </button>
          <button
            type="button"
            onClick={onReject}
            className="h-10 rounded-[10px] border border-[#F3CFCA] bg-danger-soft px-3 text-[13px] text-danger"
          >
            رفض
          </button>
        </span>
      ) : (
        <span className="flex basis-full flex-col gap-0.5 text-[13px] sm:basis-auto sm:items-end">
          <span
            className="w-fit rounded-full bg-primary-soft px-2 py-0.5 text-[12px] font-semibold"
            data-testid="request-status"
          >
            {statusLabel(row.status)}
          </span>
          {row.decided_at && (
            <span className="text-text-muted" data-testid="request-decider">
              {row.decided_by_name ?? 'أدمن محذوف'} · {formatDateTime(row.decided_at)}
            </span>
          )}
          {row.decision_note && (
            <span className="max-w-[320px] break-words" data-testid="request-note">
              {row.decision_note}
            </span>
          )}
          {canWithdraw(row.status) && (
            <button
              type="button"
              onClick={onWithdraw}
              className="mt-1 h-10 rounded-[10px] border border-[#F3CFCA] bg-danger-soft px-3 text-[13px] text-danger"
            >
              سحب الموافقة
            </button>
          )}
        </span>
      )}
    </article>
  );
}

/** قرار واحد: النجاح يحدّث كل القوائم والشارة ويغلق النافذة؛ الخطأ رسالة عربية (ويحدّث إن انحسم الطلب). */
function useDecision(row: DriverRequestRow, approve: boolean, onClose: () => void) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (note?: string) => decideDriverRequest(supabase, row.id, approve, note),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: driverRequestsKeys.all });
      onClose();
    },
    onError: async (e) => {
      const { message, refresh } = decisionErrorMessage(e);
      setError(message);
      if (refresh) await qc.invalidateQueries({ queryKey: driverRequestsKeys.all });
    },
  });
  return { mutation, error };
}

function ApproveDialog({ row, onClose }: { row: DriverRequestRow; onClose: () => void }) {
  const phone = displayPhone(row.phone);
  const [confirmed, setConfirmed] = useState(false);
  const { mutation, error } = useDecision(row, true, onClose);
  return (
    <Modal title={`موافقة على طلب ${row.full_name}`} onClose={onClose} testId="approve-dialog">
      <p className="m-0 text-[15px]">
        اتصلت بالرقم{' '}
        <span className="num font-semibold" dir="ltr">
          {phone}
        </span>{' '}
        وتأكدت أنه نفس الشخص؟
      </p>
      <label className="flex min-h-11 items-center gap-2 text-[15px]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          className="h-5 w-5 accent-primary"
        />
        اتصلت وتأكدت
      </label>
      {error && (
        <p role="alert" className="m-0 text-sm text-danger" data-testid="decision-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={approveBlocked(confirmed) || mutation.isPending}
          onClick={() => mutation.mutate(undefined)}
          className="h-11 flex-1 rounded-control bg-primary px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          {mutation.isPending ? 'جارٍ الحفظ…' : 'موافقة'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-control border border-border px-4 text-sm"
        >
          إلغاء
        </button>
      </div>
    </Modal>
  );
}

/** الرفض (من المعلّق) وسحب الموافقة (من الموافَق عليه، R1 M1) نفس القرار بقاعدة البيانات (approve = false). */
function RejectDialog({
  row,
  onClose,
  withdraw = false,
}: {
  row: DriverRequestRow;
  onClose: () => void;
  withdraw?: boolean;
}) {
  const [note, setNote] = useState('');
  const { mutation, error } = useDecision(row, false, onClose);
  return (
    <Modal
      title={withdraw ? `سحب الموافقة على ${row.full_name}` : `رفض طلب ${row.full_name}`}
      onClose={onClose}
      testId="reject-dialog"
    >
      {withdraw && (
        <p className="m-0 text-[15px]">
          الطلب يصير مرفوضاً، والجهاز ما يكدر يكمل التسجيل، وتظهر له حالة "مرفوض".
        </p>
      )}
      <Field label="ملاحظة (اختيارية)" htmlFor="reject-note" hint={`حتى ${NOTE_MAX} حرف`}>
        <textarea
          id="reject-note"
          value={note}
          maxLength={NOTE_MAX}
          rows={3}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded-control border border-border bg-surface p-3 text-[15px] text-text"
        />
      </Field>
      {error && (
        <p role="alert" className="m-0 text-sm text-danger" data-testid="decision-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate(note.trim() || undefined)}
          className="h-11 flex-1 rounded-control border border-[#F3CFCA] bg-danger-soft px-4 text-sm font-bold text-danger disabled:opacity-50"
        >
          {mutation.isPending ? 'جارٍ الحفظ…' : withdraw ? 'سحب الموافقة' : 'رفض الطلب'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-control border border-border px-4 text-sm"
        >
          إلغاء
        </button>
      </div>
    </Modal>
  );
}
