import { formatIQD, formatQuantity } from '@mukhdar/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { fetchOrderDetail } from '@/features/orders/api';
import { asAddress, displayPhone, formatDateTime, fullAddress } from '@/features/orders/format';
import { LOGIN_PATH, MFA_PATH, NOT_AUTHORIZED_PATH } from '@/lib/access';
import { getPanelUser } from '@/lib/panelUser';
import { createClient } from '@/lib/supabase/server';
import { ServiceUnavailable } from '@/components/ServiceUnavailable';
import { AutoPrint } from './AutoPrint';
import './receipt.css';

export const metadata: Metadata = { title: 'إيصال الطلب' };

// إيصال لطابعة 80mm (SPEC-admin §2.1): بلا كلفة ولا ربح، يفتح نافذة الطباعة تلقائياً.
export default async function PrintOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const user = await getPanelUser(supabase);
  if (user.state === 'unavailable') return <ServiceUnavailable />;
  if (user.state === 'anonymous') redirect(LOGIN_PATH);
  if (user.state === 'forbidden') redirect(NOT_AUTHORIZED_PATH);
  if (user.mfaRequired) redirect(MFA_PATH);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const order = await fetchOrderDetail(supabase, id);
  if (!order) notFound();
  const address = asAddress(order.address_snapshot);

  return (
    <main className="receipt" data-testid="receipt">
      <AutoPrint />
      <h1>المخضر</h1>
      <p className="center num">طلب #{order.order_number}</p>
      <p className="center num small">{formatDateTime(order.created_at)}</p>
      <hr />
      <p>
        <strong>{order.customer_name ?? 'بدون اسم'}</strong>
        {order.customer_phone && (
          <span dir="ltr" className="num">
            {' '}
            {displayPhone(order.customer_phone)}
          </span>
        )}
      </p>
      <p>{fullAddress(address)}</p>
      {address.note && <p className="small">ملاحظة العنوان: {address.note}</p>}
      {order.note && <p className="note">ملاحظة الطلب: {order.note}</p>}
      <hr />
      <table>
        <tbody>
          {order.order_items.map((i) => (
            <tr key={i.id}>
              <td>{i.name_snapshot}</td>
              <td className="num nowrap">{formatQuantity(i.qty, i.unit_snapshot)}</td>
              <td className="num nowrap end">{formatIQD(i.line_total_iqd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <hr />
      <table>
        <tbody>
          <tr>
            <td>المجموع الفرعي</td>
            <td className="num end">{formatIQD(order.subtotal_iqd)}</td>
          </tr>
          <tr>
            <td>أجرة التوصيل</td>
            <td className="num end">{formatIQD(order.delivery_fee_iqd)}</td>
          </tr>
          <tr className="total">
            <td>الكلي</td>
            <td className="num end">{formatIQD(order.total_iqd)}</td>
          </tr>
        </tbody>
      </table>
      <p className="center">الدفع نقداً عند الاستلام</p>
    </main>
  );
}
