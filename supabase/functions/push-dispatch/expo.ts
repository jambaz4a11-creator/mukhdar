// مُرسِل Expo Push. EXPO_ACCESS_TOKEN اختياري (يُستخدم فقط إن فُعّل "Enhanced security" بحساب Expo).
//
// مشاريع Expo المختلطة (تطبيق الزبون وتطبيق السائق الخارجي غالباً مشروعان مختلفان):
// Expo يرفض الطلب كاملاً إن خلط رموزاً من أكثر من مشروع، بخطأ على مستوى الطلب
//   { "errors": [{ "code": "PUSH_TOO_MANY_EXPERIENCE_IDS", "message": "...", "details": { ... } }] }
// و details (حسب docs.expo.dev/push-notifications/sending-notifications، "Request errors")
// "mapping of experience names to their associated push tokens". التوثيق لا يعرض شكل القيم،
// لذلك نقرأها بحذر: مصفوفة نصوص لكل مشروع (المتوقع). عندها نقسم الدفعة حسب المشروع ونعيد
// إرسال كل جزء. إن لم نفهم details (أو بقيت رموز بلا مشروع)، نرسل تلك الرسائل واحدة واحدة.
// الربط رمز ← مشروع يُحفظ طوال استدعاء الدالة، فالدفعات اللاحقة تُجمَّع مسبقاً بلا رفض.
import type { PushMessage, Sender, SendOutcome } from './dispatch.ts';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_BATCH_SIZE = 100;
export const MIXED_PROJECTS_CODE = 'PUSH_TOO_MANY_EXPERIENCE_IDS';

export interface ExpoSenderOptions {
  fetch?: typeof fetch;
  accessToken?: string | null;
  url?: string;
  timeoutMs?: number;
}

interface ExpoTicket {
  status?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoRequestError {
  code?: string;
  message?: string;
  details?: unknown;
}

interface ExpoResponse {
  data?: ExpoTicket[];
  errors?: ExpoRequestError[];
}

function ticketOutcome(t: ExpoTicket | undefined): SendOutcome {
  if (t?.status === 'ok') return { status: 'ok' };
  const code = t?.details?.error;
  if (code === 'DeviceNotRegistered') return { status: 'dead', error: 'DeviceNotRegistered' };
  return { status: 'error', error: `expo: ${code ?? t?.message ?? 'unknown ticket error'}` };
}

/** details لخطأ المشاريع المختلطة ← رمز → مشروع. يتجاهل أي قيمة ليست مصفوفة نصوص. */
export function parseExperienceDetails(details: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!details || typeof details !== 'object' || Array.isArray(details)) return map;
  for (const [experience, tokens] of Object.entries(details as Record<string, unknown>)) {
    if (!Array.isArray(tokens)) continue;
    for (const t of tokens) if (typeof t === 'string') map.set(t, experience);
  }
  return map;
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createExpoSender(options: ExpoSenderOptions = {}): Sender {
  const doFetch = options.fetch ?? fetch;
  const url = options.url ?? EXPO_PUSH_URL;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

  /** رمز → مشروع، يُتعلَّم من أخطاء المشاريع المختلطة خلال عمر هذا الـ sender. */
  const projectOf = new Map<string, string>();

  type Attempt =
    | { kind: 'tickets'; outcomes: SendOutcome[] }
    | { kind: 'mixed'; details: unknown }
    | { kind: 'failed'; error: string };

  async function post(chunk: PushMessage[]): Promise<Attempt> {
    const body = chunk.map((m) => ({
      to: m.to,
      title: m.title,
      body: m.body,
      data: m.data,
      sound: 'default',
      priority: 'high',
      channelId: 'orders',
    }));
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
      });
      const text = await res.text().catch(() => '');
      let json: ExpoResponse | null = null;
      try {
        json = JSON.parse(text) as ExpoResponse;
      } catch {
        json = null;
      }
      const mixed = json?.errors?.find((e) => e?.code === MIXED_PROJECTS_CODE);
      if (mixed) return { kind: 'mixed', details: mixed.details };
      if (!res.ok) {
        return { kind: 'failed', error: `expo: HTTP ${res.status} ${text.slice(0, 200)}`.trim() };
      }
      if (!json || !Array.isArray(json.data) || json.data.length !== chunk.length) {
        return {
          kind: 'failed',
          error: `expo: ${json?.errors?.[0]?.message ?? 'unexpected response'}`,
        };
      }
      return { kind: 'tickets', outcomes: json.data.map(ticketOutcome) };
    } catch (e) {
      return { kind: 'failed', error: `expo: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** يرسل دفعة (≤ 100). عند رفض المشاريع المختلطة: يقسم ويعيد مرة واحدة (split = false بعدها). */
  async function sendChunk(chunk: PushMessage[], split = true): Promise<SendOutcome[]> {
    const attempt = await post(chunk);
    if (attempt.kind === 'tickets') return attempt.outcomes;
    if (attempt.kind === 'failed')
      return chunk.map(() => ({ status: 'error', error: attempt.error }));

    // المشاريع المختلطة
    if (!split || chunk.length === 1) {
      return chunk.map(() => ({ status: 'error', error: `expo: ${MIXED_PROJECTS_CODE}` }));
    }
    for (const [token, project] of parseExperienceDetails(attempt.details)) {
      projectOf.set(token, project);
    }
    const groups = new Map<string, number[]>();
    const unknown: number[] = [];
    chunk.forEach((m, i) => {
      const project = projectOf.get(m.to);
      if (project === undefined) unknown.push(i);
      else {
        const list = groups.get(project) ?? [];
        list.push(i);
        groups.set(project, list);
      }
    });

    const out: SendOutcome[] = new Array(chunk.length);
    const parts = [...groups.values(), ...unknown.map((i) => [i])]; // المجهول: رسالة لكل طلب
    for (const indexes of parts) {
      const results = await sendChunk(
        indexes.map((i) => chunk[i] as PushMessage),
        false,
      );
      indexes.forEach((i, k) => (out[i] = results[k] as SendOutcome));
    }
    return out;
  }

  return async (messages) => {
    // تجميع مسبق حسب المشروع المعروف (المجهول معاً تحت '')، والنتائج بنفس ترتيب الرسائل
    const groups = new Map<string, { m: PushMessage; i: number }[]>();
    messages.forEach((m, i) => {
      const p = projectOf.get(m.to) ?? '';
      const list = groups.get(p) ?? [];
      list.push({ m, i });
      groups.set(p, list);
    });

    const out: SendOutcome[] = new Array(messages.length);
    for (const group of groups.values()) {
      for (const part of chunks(group, EXPO_BATCH_SIZE)) {
        const results = await sendChunk(part.map((x) => x.m));
        part.forEach((x, k) => (out[x.i] = results[k] as SendOutcome));
      }
    }
    return out;
  };
}
