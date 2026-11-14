// الثيم الوحيد لتطبيق الزبون، مبني من docs/design/README.md (اختبار theme.test.ts يطابقهما).
// الشاشات تستورد من هنا فقط: لا ألوان ولا مقاسات مكتوبة مباشرة بالشاشات.
// ألوان شارات حالة الطلب ليست هنا: STATUS_COLORS من @mukhdar/shared.

export const colors = {
  primary: '#1F6B3A',
  primaryPressed: '#174F2B',
  primarySoft: '#E8F2EA',
  background: '#F7F8F3',
  surface: '#FFFFFF',
  border: '#E3E7DE',
  divider: '#EEF0EB',
  text: '#1B1F1A',
  textMuted: '#5B6458',
  danger: '#A1332A',
  dangerSoft: '#FCEDEB',
  warningText: '#7A4A00',
  warningSoft: '#FFF1DC',
  star: '#E8A13A',
} as const;

/** أسماء العائلات كما تُحمَّل بـ useFonts (IBM Plex Sans Arabic، يغطي العربي واللاتيني). */
export const fonts = {
  regular: 'IBMPlexSansArabic_400Regular',
  medium: 'IBMPlexSansArabic_500Medium',
  semibold: 'IBMPlexSansArabic_600SemiBold',
  bold: 'IBMPlexSansArabic_700Bold',
} as const;

export const fontSizes = {
  caption: 12,
  small: 14,
  body: 16,
  title: 18,
  heading: 22,
  display: 28,
} as const;

export const radius = {
  /** أزرار صغيرة، عدادات */
  control: 12,
  /** حقول الإدخال */
  input: 14,
  /** البطاقات والأزرار الرئيسية */
  card: 16,
  /** الشرائح والشارات */
  full: 999,
} as const;

export const spacing = {
  /** حشوة الشاشة */
  screen: 20,
  xs: 8,
  sm: 10,
  md: 12,
  lg: 16,
} as const;

export const sizes = {
  /** أقل مساحة لمس */
  touchTarget: 44,
  primaryButton: 56,
  tabBar: 72,
} as const;

export const theme = { colors, fonts, fontSizes, radius, spacing, sizes } as const;
export type Theme = typeof theme;
