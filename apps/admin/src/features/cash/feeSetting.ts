// إعداد "أجرة التوصيل وتسليم الكاش" (SPEC-cash K19 و§4، SPEC-admin §2.10). يُحفظ عبر update_app_settings بمفتاحه
// وحده (المفاتيح اختيارية بالدالة)، فلا يمس باقي الإعدادات ولا يختلط بنموذجها.
import { formatIQD } from '@mukhdar/shared';

export const FEE_SECTION_TITLE = 'أجرة التوصيل وتسليم الكاش';

export const FEE_OPTIONS = [
  {
    value: true,
    label: 'أجرة التوصيل للمحل',
    description:
      'السائق يسلّم المجموع كاملاً (البضاعة + أجرة التوصيل)، والمحل يدفع للسائق أجوره بطريقته.',
  },
  {
    value: false,
    label: 'أجرة التوصيل تبقى عند السائق',
    description: 'السائق يسلّم مبلغ البضاعة فقط ويحتفظ بأجرة كل توصيل.',
  },
] as const;

export const FEE_WARNING =
  'التغيير يسري على الكاش اللي بيد السواق الآن والتسليمات الجاية فقط. التسليمات المسجّلة قبل التغيير ما تتغير.';

export function feePayload(includesDeliveryFee: boolean): {
  cash_handover_includes_delivery_fee: boolean;
} {
  return { cash_handover_includes_delivery_fee: includesDeliveryFee };
}

/**
 * R4 M1: تأكيد قبل تغيير الإعداد والسواق بيدهم كاش فيه أجور توصيل. الرقم من cash_fee_setting_impact (K20).
 * null = لا أجرة بيد أحد، فيُحفظ بلا سؤال. next = القيمة الجديدة (true = الأجرة للمحل).
 */
export function feeChangeWarning(
  impact: { driver_count: number; order_count: number; fees_iqd: number },
  next: boolean,
): string | null {
  if (impact.fees_iqd <= 0) return null;
  const who = `${impact.driver_count} سائق بيدهم أجرة توصيل ${formatIQD(impact.fees_iqd)} عن ${impact.order_count} طلب ما سلّموه بعد.`;
  return next
    ? `${who} بعد الحفظ تنضاف هاي الأجرة للمطلوب منهم.`
    : `${who} بعد الحفظ ما تنطلب منهم وتبقى عندهم، وتظهر بالتقارير بـ "أجرة التوصيل عند السواق".`;
}
