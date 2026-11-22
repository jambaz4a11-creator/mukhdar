// مدة مضت بالعربي (لهجة التطبيقين): دقائق ← ساعات ← أيام، بالمفرد والمثنى والجمع الصحيح.
// "دقيقة"، "دقيقتين"، "5 دقائق"، "45 دقيقة"، "ساعة"، "ساعتين"، "3 ساعات"، "11 ساعة"، "يوم"، "يومين"، "4 أيام"، "12 يوم".
// يُستعمل بعد حرف مثل "من" ("جاهز من ساعتين"). أقل من دقيقة ← '' (المستدعي يقرر: "هسه").

const HOUR = 60;
const DAY = 24 * HOUR;

function count(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  return n <= 10 ? `${n} ${few}` : `${n} ${many}`;
}

/** العبارة لعدد دقائق صحيح مضى (يُقرَّب للأسفل لأكبر وحدة). سالب/صفر/غير رقم ← ''. */
export function formatElapsedAr(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return '';
  const m = Math.floor(minutes);
  if (m < HOUR) return count(m, 'دقيقة', 'دقيقتين', 'دقائق', 'دقيقة');
  if (m < DAY) return count(Math.floor(m / HOUR), 'ساعة', 'ساعتين', 'ساعات', 'ساعة');
  return count(Math.floor(m / DAY), 'يوم', 'يومين', 'أيام', 'يوم');
}
