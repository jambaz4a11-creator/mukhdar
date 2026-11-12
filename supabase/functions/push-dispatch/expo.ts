// مُرسِل Expo Push. EXPO_ACCESS_TOKEN اختياري (يُستخدم فقط إن فُعّل "Enhanced security" بحساب Expo).
import type { PushMessage, Sender, SendOutcome } from './dispatch.ts';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
export const EXPO_BATCH_SIZE = 100;

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

function ticketOutcome(t: ExpoTicket | undefined): SendOutcome {
  if (t?.status === 'ok') return { status: 'ok' };
  const code = t?.details?.error;
  if (code === 'DeviceNotRegistered') return { status: 'dead', error: 'DeviceNotRegistered' };
  return { status: 'error', error: `expo: ${code ?? t?.message ?? 'unknown ticket error'}` };
}

export function createExpoSender(options: ExpoSenderOptions = {}): Sender {
  const doFetch = options.fetch ?? fetch;
  const url = options.url ?? EXPO_PUSH_URL;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`;

  async function sendChunk(chunk: PushMessage[]): Promise<SendOutcome[]> {
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
      if (!res.ok) {
        const text = (await res.text().catch(() => '')).slice(0, 200);
        return chunk.map(() => ({
          status: 'error',
          error: `expo: HTTP ${res.status} ${text}`.trim(),
        }));
      }
      const json = (await res.json()) as { data?: ExpoTicket[]; errors?: { message?: string }[] };
      if (!Array.isArray(json.data) || json.data.length !== chunk.length) {
        const msg = json.errors?.[0]?.message ?? 'unexpected response';
        return chunk.map(() => ({ status: 'error', error: `expo: ${msg}` }));
      }
      return json.data.map(ticketOutcome);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return chunk.map(() => ({ status: 'error', error: `expo: ${msg}` }));
    }
  }

  return async (messages) => {
    const out: SendOutcome[] = [];
    for (let i = 0; i < messages.length; i += EXPO_BATCH_SIZE) {
      out.push(...(await sendChunk(messages.slice(i, i + EXPO_BATCH_SIZE))));
    }
    return out;
  };
}
