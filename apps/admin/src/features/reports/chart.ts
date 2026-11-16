// هندسة الرسم اليومي (المبيعات وصافي الربح) بمحور واحد وخط صفر: صافي الربح قد يكون سالباً
// (هدر أو نقص بيوم بلا مبيعات)، فيُرسم تحت خط الصفر. دالة صرفة تُختبر بلا متصفح.
export interface ChartDay {
  day: string;
  sales_iqd: number;
  net_profit_iqd: number;
}

export interface ChartGeometry {
  /** موضع خط الصفر من الأعلى، نسبة 0..100 من ارتفاع الرسم */
  zeroPct: number;
  bars: { day: string; salesPct: number; netPct: number; netNegative: boolean }[];
}

export function chartGeometry(days: readonly ChartDay[]): ChartGeometry {
  const maxPos = Math.max(0, ...days.map((d) => Math.max(d.sales_iqd, d.net_profit_iqd)));
  const maxNeg = Math.max(0, ...days.map((d) => -d.net_profit_iqd));
  const span = maxPos + maxNeg;
  if (span === 0) {
    return {
      zeroPct: 100,
      bars: days.map((d) => ({ day: d.day, salesPct: 0, netPct: 0, netNegative: false })),
    };
  }
  return {
    zeroPct: (maxPos / span) * 100,
    bars: days.map((d) => ({
      day: d.day,
      salesPct: (Math.max(0, d.sales_iqd) / span) * 100,
      netPct: (Math.abs(d.net_profit_iqd) / span) * 100,
      netNegative: d.net_profit_iqd < 0,
    })),
  };
}

/** كل كم يوم تُكتب تسمية المحور (حتى لا تتزاحم): 7 تسميات تقريباً. */
export function labelEvery(count: number): number {
  return count <= 10 ? 1 : Math.ceil(count / 7);
}
