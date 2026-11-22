'use client';
// تسليم الكاش (`/cash`، أدمن وموظف، SPEC-admin §2.11، SPEC-cash §4): الرأس (الكاش عند السواق الآن)، تبويب
// "الأرصدة" (نافذة الاستلام) وتبويب "السجل" (التصحيح للأدمن). كل الأرقام من دوال قاعدة البيانات.
// التحديث: عند تركيز النافذة (إعداد المزوّد)، وكل 30 ثانية والصفحة ظاهرة، وبعد كل عملية. لا Realtime.
import { errorMessage } from '@mukhdar/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { usePanel } from '@/components/PanelProviders';
import { cashKeys, fetchOutstanding, type HandoverRow, type OutstandingRow } from './api';
import { BalancesTab } from './BalancesTab';
import { CorrectDialog } from './CorrectDialog';
import { HandoverDialog } from './HandoverDialog';
import { HistoryTab } from './HistoryTab';
import { heldNowLine } from './text';

const POLL_MS = 30_000;
type Tab = 'balances' | 'history';
const TABS: { id: Tab; label: string }[] = [
  { id: 'balances', label: 'الأرصدة' },
  { id: 'history', label: 'السجل' },
];

export function CashScreen() {
  const { supabase } = usePanel();
  const [tab, setTab] = useState<Tab>('balances');
  const [receiving, setReceiving] = useState<string | null>(null); // driver_id
  const [receivingRow, setReceivingRow] = useState<OutstandingRow | null>(null);
  const [correcting, setCorrecting] = useState<HandoverRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const outstanding = useQuery({
    queryKey: cashKeys.outstanding,
    queryFn: () => fetchOutstanding(supabase),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  });
  const rows = outstanding.data ?? [];
  const held = rows.reduce((s, r) => s + r.outstanding_iqd, 0);
  const heldDrivers = rows.filter((r) => r.outstanding_iqd > 0).length;

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  const liveRow = receiving
    ? rows.find((r) => r.driver_id === receiving && r.outstanding_iqd > 0)
    : undefined;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="m-0 text-[26px] font-bold">تسليم الكاش</h1>
        <span className="text-sm text-text-muted">
          السائق يسلّم كل كاش توصيلاته مرة وحدة، وأنت تكتب المبلغ اللي استلمته فعلاً.
        </span>
        {outstanding.isSuccess && (
          <span
            className="num mt-1 w-fit rounded-control bg-primary-soft px-3 py-1.5 text-[15px] font-bold text-primary"
            data-testid="cash-held-now"
          >
            {heldNowLine(held, heldDrivers)}
          </span>
        )}
      </header>

      {notice && (
        <p
          role="status"
          data-testid="cash-notice"
          className="m-0 rounded-control bg-primary-soft px-3 py-2 text-sm text-primary"
        >
          {notice}
        </p>
      )}

      <div role="tablist" aria-label="تسليم الكاش" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`cash-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="cash-panel"
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
        id="cash-panel"
        role="tabpanel"
        aria-labelledby={`cash-tab-${tab}`}
        className="flex flex-col rounded-card border border-border bg-surface px-[18px] py-2"
      >
        {tab === 'balances' ? (
          <>
            {outstanding.isPending && <p className="text-sm text-text-muted">جارٍ التحميل…</p>}
            {outstanding.error && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(outstanding.error)}
              </p>
            )}
            {outstanding.isSuccess && (
              <BalancesTab
                rows={rows}
                onReceive={(r) => {
                  setReceiving(r.driver_id);
                  setReceivingRow(r);
                }}
              />
            )}
          </>
        ) : (
          <div className="py-3">
            <HistoryTab onCorrect={setCorrecting} />
          </div>
        )}
      </section>

      {receivingRow && (
        <HandoverDialog
          key={receivingRow.driver_id}
          row={receivingRow}
          live={liveRow}
          onNotice={setNotice}
          onClose={() => {
            setReceiving(null);
            setReceivingRow(null);
          }}
        />
      )}
      {correcting && (
        <CorrectDialog row={correcting} onNotice={setNotice} onClose={() => setCorrecting(null)} />
      )}
    </div>
  );
}
