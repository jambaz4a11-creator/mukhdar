// منطق الإرسال (بدون شبكة ولا قاعدة بيانات): يُختبر بـ store و senders مزيفة.
//
// لكل صف بالصندوق: كل رمز يُرسل عبر مزوّده (push_tokens.provider). مزوّد بلا sender
// (حالياً fcm) يُتخطى رمزه مع ملاحظة واضحة بـ last_error.
//
// نتيجة الصف:
//   * وصل لرمز واحد على الأقل      ← ok (مع ملاحظة إن فشل بعضها/تُخطي). لا إعادة، كي لا يتكرر الإشعار.
//   * بلا رموز                      ← ok مع "no recipients" (لا أحد لإرساله؛ لا فائدة من الإعادة).
//   * كل الأخطاء مؤقتة (شبكة/HTTP)  ← فشل يُعاد (attempts + 1، ونهائي عند المحاولة الخامسة).
//   * الباقي ميت/متخطى فقط          ← فشل نهائي بسبب واضح.

export type Provider = 'expo' | 'fcm';

export interface Recipient {
  token: string;
  provider: Provider;
  platform: string;
}

export interface OutboxRow {
  id: number;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
  recipients: Recipient[];
}

export interface RowResult {
  id: number;
  ok: boolean;
  error: string | null;
  final: boolean;
}

export interface Store {
  claim(limit: number): Promise<OutboxRow[]>;
  finish(results: RowResult[], deadTokens: string[]): Promise<void>;
}

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

export type SendOutcome =
  { status: 'ok' } | { status: 'dead'; error: string } | { status: 'error'; error: string };

/** يرسل الرسائل ويرجع نتيجة لكل رسالة بنفس الترتيب. */
export type Sender = (messages: PushMessage[]) => Promise<SendOutcome[]>;

export type Senders = Partial<Record<Provider, Sender>>;

export const MAX_ATTEMPTS = 5;
export const CLAIM_LIMIT = 200;

export interface DispatchSummary {
  claimed: number;
  sent: number;
  failed: number;
  deadTokens: number;
}

interface Tally {
  sent: number;
  dead: number;
  errors: string[];
  skipped: Partial<Record<Provider, number>>;
}

function describe(t: Tally): string[] {
  const notes: string[] = [];
  for (const [provider, n] of Object.entries(t.skipped)) {
    notes.push(`${provider}: ${n} token(s) skipped (provider not implemented)`);
  }
  if (t.dead > 0) notes.push(`${t.dead} token(s) DeviceNotRegistered (removed)`);
  if (t.errors.length > 0) {
    const unique = [...new Set(t.errors)];
    notes.push(`${t.errors.length} send error(s): ${unique.slice(0, 3).join('; ')}`);
  }
  return notes;
}

export function rowResult(row: OutboxRow, t: Tally): RowResult {
  const notes = describe(t);
  const note = notes.length > 0 ? notes.join(' | ') : null;
  if (row.recipients.length === 0)
    return { id: row.id, ok: true, error: 'no recipients', final: false };
  if (t.sent > 0) return { id: row.id, ok: true, error: note, final: false };
  if (t.errors.length > 0) {
    return { id: row.id, ok: false, error: note, final: row.attempts + 1 >= MAX_ATTEMPTS };
  }
  return { id: row.id, ok: false, error: note, final: true };
}

/** يرسل دفعة واحدة محجوزة. */
export async function dispatchOnce(
  store: Store,
  senders: Senders,
  limit = CLAIM_LIMIT,
): Promise<DispatchSummary> {
  const rows = await store.claim(limit);
  if (rows.length === 0) return { claimed: 0, sent: 0, failed: 0, deadTokens: 0 };

  const tallies: Tally[] = rows.map(() => ({ sent: 0, dead: 0, errors: [], skipped: {} }));

  // رسائل كل مزوّد عبر كل الصفوف (التقسيم لدفعات داخل الـ sender).
  const byProvider = new Map<Provider, { tally: Tally; message: PushMessage }[]>();
  rows.forEach((row, index) => {
    const tally = tallies[index] as Tally;
    for (const r of row.recipients) {
      if (!senders[r.provider]) {
        tally.skipped[r.provider] = (tally.skipped[r.provider] ?? 0) + 1;
        continue;
      }
      const list = byProvider.get(r.provider) ?? [];
      list.push({
        tally,
        message: { to: r.token, title: row.title, body: row.body, data: row.data ?? {} },
      });
      byProvider.set(r.provider, list);
    }
  });

  const deadTokens: string[] = [];
  for (const [provider, items] of byProvider) {
    const sender = senders[provider] as Sender;
    let outcomes: SendOutcome[];
    try {
      outcomes = await sender(items.map((i) => i.message));
      if (outcomes.length !== items.length) throw new Error('sender returned wrong result count');
    } catch (e) {
      const error = `${provider}: ${e instanceof Error ? e.message : String(e)}`;
      outcomes = items.map(() => ({ status: 'error', error }));
    }
    items.forEach(({ tally, message }, i) => {
      const o = outcomes[i] as SendOutcome;
      if (o.status === 'ok') tally.sent++;
      else if (o.status === 'dead') {
        tally.dead++;
        deadTokens.push(message.to);
      } else tally.errors.push(o.error);
    });
  }

  const results = rows.map((r, i) => rowResult(r, tallies[i] as Tally));
  const uniqueDead = [...new Set(deadTokens)];
  await store.finish(results, uniqueDead);

  const sent = results.filter((r) => r.ok).length;
  return { claimed: rows.length, sent, failed: rows.length - sent, deadTokens: uniqueDead.length };
}

/** يكرر حتى يفرغ الصندوق أو يبلغ الحد (لا حلقة لا نهائية). */
export async function dispatchAll(
  store: Store,
  senders: Senders,
  { limit = CLAIM_LIMIT, maxRounds = 5 } = {},
): Promise<DispatchSummary> {
  const total: DispatchSummary = { claimed: 0, sent: 0, failed: 0, deadTokens: 0 };
  for (let round = 0; round < maxRounds; round++) {
    const s = await dispatchOnce(store, senders, limit);
    total.claimed += s.claimed;
    total.sent += s.sent;
    total.failed += s.failed;
    total.deadTokens += s.deadTokens;
    if (s.claimed < limit) break;
  }
  return total;
}
