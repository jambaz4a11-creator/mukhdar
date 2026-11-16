// قراءة التقييمات (T26): الأرقام والقائمة من دالتي قاعدة البيانات ratings_summary / ratings_list
// (migration 20261128000001)؛ المتصفح لا يحسب متوسطاً ولا توزيعاً. تعليقات التقارير من نفس ratings_list.
import type { MukhdarClient } from '@mukhdar/shared';
import { dateArgs, presetArgs, type RatingFilters } from './filters';

export const RATINGS_PAGE_SIZE = 50;

export const ratingsKeys = {
  all: ['ratings'] as const,
  summary: (f: RatingFilters) => ['ratings', 'summary', f] as const,
  list: (f: RatingFilters) => ['ratings', 'list', f] as const,
};

export interface RatingsSummary {
  count: number;
  /** رقم عشري واحد؛ null بلا تقييمات */
  avg: number | null;
  distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
}

export interface RatingRow {
  order_id: string;
  order_number: number;
  customer_name: string | null;
  stars: number;
  comment: string | null;
  created_at: string;
}

export interface RatingCursor {
  created_at: string;
  order_id: string;
}

const STAR_KEYS = ['1', '2', '3', '4', '5'] as const;

/** يتحقق من شكل ratings_summary: الأعداد صحيحة، والمتوسط بين 1 و5 أو null. */
export function parseRatingsSummary(raw: unknown): RatingsSummary {
  if (!raw || typeof raw !== 'object') throw new Error('RATINGS_SHAPE');
  const r = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(r.count) || (r.count as number) < 0)
    throw new Error('RATINGS_SHAPE: count');
  if (r.avg !== null && (typeof r.avg !== 'number' || r.avg < 1 || r.avg > 5))
    throw new Error('RATINGS_SHAPE: avg');
  const d = r.distribution as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') throw new Error('RATINGS_SHAPE: distribution');
  for (const k of STAR_KEYS) {
    if (!Number.isSafeInteger(d[k]) || (d[k] as number) < 0)
      throw new Error(`RATINGS_SHAPE: distribution.${k}`);
  }
  return raw as RatingsSummary;
}

export async function fetchRatingsSummary(
  client: MukhdarClient,
  f: RatingFilters,
): Promise<RatingsSummary> {
  const { data, error } = await client.rpc('ratings_summary', {
    ...dateArgs(f),
    ...presetArgs(f.preset),
  });
  if (error) throw error;
  return parseRatingsSummary(data);
}

export interface RatingsPage {
  rows: RatingRow[];
  next: RatingCursor | null;
}

export async function fetchRatingsPage(
  client: MukhdarClient,
  f: RatingFilters,
  cursor: RatingCursor | null,
  limit: number = RATINGS_PAGE_SIZE,
): Promise<RatingsPage> {
  const { data, error } = await client.rpc('ratings_list', {
    ...dateArgs(f),
    ...presetArgs(f.preset),
    ...(cursor ? { p_before_created: cursor.created_at, p_before_order: cursor.order_id } : {}),
    p_limit: limit,
  });
  if (error) throw error;
  const rows = (data ?? []) as RatingRow[];
  const last = rows.at(-1);
  return {
    rows,
    next:
      rows.length === limit && last
        ? { created_at: last.created_at, order_id: last.order_id }
        : null,
  };
}
