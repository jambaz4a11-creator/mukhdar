// كل نصوص الواجهة بملف واحد (جاهز لإضافة لغة لاحقاً). الأرقام لاتينية (SPEC-customer افتراض 1).
export const ar = {
  appName: 'المخضر',
  tabs: {
    home: 'الرئيسية',
    cart: 'السلة',
    orders: 'طلباتي',
    account: 'حسابي',
  },
  home: {
    title: 'المخضر',
    subtitle: 'خضار وفواكه طازجة لباب بيتك في بسماية',
    settingsTitle: 'حالة المتجر',
    storeOpen: 'المتجر مفتوح',
    storeClosed: 'المتجر مغلق حالياً',
    deliveryFee: 'أجرة التوصيل',
    minOrder: 'الحد الأدنى للطلب',
    noMinOrder: 'لا يوجد',
    loading: 'جارٍ التحميل…',
    retry: 'إعادة المحاولة',
    notConfigured: 'إعداد الاتصال ناقص: أضف رابط Supabase والمفتاح العام بملف .env',
  },
  placeholders: {
    cart: 'السلة فارغة',
    orders: 'لا توجد طلبات بعد',
    account: 'سجّل الدخول لعرض حسابك',
    soon: 'قريباً',
  },
  dev: {
    sentryTest: 'إرسال خطأ تجريبي إلى Sentry',
    sentrySent: 'أُرسل الخطأ التجريبي',
  },
} as const;
