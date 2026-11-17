'use client';
// T23 H2: "إلغاء كل طلباته وتعطيل الحساب" لزبون مشبوه (طلبات وهمية تحجز المخزون). أدمن فقط (الدالة تتحقق).
// تأكيد صريح قبل التنفيذ؛ يُدقَّق بـ admin_audit (customer_lockdown). T23 F L4: الطلب بالطريق لا يُلغى هنا (البضاعة
// مع السائق وقد ترجع)؛ تُعرض أرقامه ليقرر الأدمن من صفحة الطلبات (تسليم، أو إلغاء بإرجاع أو بلا إرجاع).
import Link from 'next/link';
import { errorMessage } from '@mukhdar/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePanel } from '@/components/PanelProviders';
import { Modal } from '@/features/catalog/ui';
import { ordersKeys } from '@/features/orders/api';
import { cancelCustomerOrders, type LockdownResult } from './api';

export function LockdownDialog({
  userId,
  label,
  onClose,
}: {
  userId: string;
  /** اسم الزبون ورقمه للتأكيد */
  label: string;
  onClose: () => void;
}) {
  const { supabase } = usePanel();
  const qc = useQueryClient();
  const run = useMutation<LockdownResult>({
    mutationFn: () => cancelCustomerOrders(supabase, userId),
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['admin'] });
      await qc.invalidateQueries({ queryKey: ordersKeys.all });
    },
  });

  return (
    <Modal title="إلغاء كل الطلبات وتعطيل الحساب" onClose={onClose} testId="lockdown-dialog">
      {run.data ? (
        <div className="flex flex-col gap-3" data-testid="lockdown-done">
          <p role="status" className="m-0 text-[15px]">
            انعطّل الحساب وانلغى <strong className="num">{run.data.cancelled}</strong> طلب ورجع
            مخزونها. انسجّل الإجراء بسجل التدقيق.
          </p>
          {run.data.out_for_delivery_numbers.length > 0 && (
            <div
              data-testid="lockdown-on-the-way"
              className="flex flex-col gap-1.5 rounded-control bg-warning-soft px-3 py-2 text-sm leading-6"
            >
              <span>
                طلبات بالطريق لم تُلغَ (البضاعة مع السائق): قرّر لكل طلب من صفحته، تسليم أو إلغاء.
              </span>
              <span className="flex flex-wrap gap-2">
                {run.data.out_for_delivery_numbers.map((n) => (
                  <Link
                    key={n}
                    href={`/orders?q=${n}`}
                    className="num font-semibold text-primary underline"
                  >
                    #{n}
                  </Link>
                ))}
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-control border border-border text-sm"
          >
            تم، أغلق
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-[15px] font-semibold">{label}</p>
          <ul className="m-0 flex list-disc flex-col gap-1 ps-5 text-sm leading-6">
            <li>تُلغى طلباته المفتوحة (قيد الانتظار والتحضير والجاهزة) ويرجع مخزونها.</li>
            <li>الطلب الذي بالطريق لا يُلغى: تظهر أرقامه لتقرر أنت (تسليم أو إلغاء).</li>
            <li>يتعطّل حسابه ويطلع من كل أجهزته، ولا يقدر يطلب أو يدخل.</li>
            <li>الإجراء يُسجَّل بسجل التدقيق باسمك. تقدر تعيد تفعيل الحساب لاحقاً من الموظفين.</li>
          </ul>
          {run.error && (
            <p
              role="alert"
              className="m-0 rounded-control bg-danger-soft px-3 py-2 text-sm text-danger"
            >
              {errorMessage(run.error)}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={run.isPending}
              onClick={() => run.mutate()}
              data-testid="lockdown-confirm"
              className="h-11 flex-1 rounded-control bg-danger text-sm font-semibold text-white disabled:opacity-60"
            >
              {run.isPending ? 'جارٍ التنفيذ…' : 'تأكيد: ألغِ وعطّل'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-11 flex-1 rounded-control border border-border text-sm"
            >
              تراجع
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
