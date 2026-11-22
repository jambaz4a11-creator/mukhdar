// إعداد "أجرة التوصيل وتسليم الكاش" (SPEC-cash K19 و§4، SPEC-admin §2.10). يُحفظ عبر update_app_settings بمفتاحه
// وحده (المفاتيح اختيارية بالدالة)، فلا يمس باقي الإعدادات ولا يختلط بنموذجها.

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
