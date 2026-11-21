// يشغّل public/sw.js داخل vm بـ self وهمي لاختبار معالجاته (T38). بلا شبكة ولا متصفح.
// يُستعمل بنفس الشكل بتطبيق الزبون (نسخة مطابقة بمجلده).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

type Handler = (event: Record<string, unknown>) => void;

export interface FakeWindow {
  url: string;
  focus: jest.Mock;
  postMessage: jest.Mock;
}

export interface FakeSw {
  shown: { title: string; options: Record<string, unknown> }[];
  opened: string[];
  windows: FakeWindow[];
  claimed: () => boolean;
  /** يُشغّل حدثاً ويرجع الوعود المسلَّمة لـ waitUntil. */
  fire(type: string, event?: Record<string, unknown>): Promise<unknown>;
}

export function loadSw(file: string, origin = 'https://app.test'): FakeSw {
  const handlers = new Map<string, Handler>();
  let claimed = false;
  const state: FakeSw = {
    shown: [],
    opened: [],
    windows: [],
    claimed: () => claimed,
    fire: () => Promise.resolve(),
  };
  const self = {
    location: { origin },
    addEventListener: (t: string, h: Handler) => handlers.set(t, h),
    skipWaiting: jest.fn(),
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        state.shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim: () => {
        claimed = true;
        return Promise.resolve();
      },
      matchAll: () => Promise.resolve(state.windows),
      openWindow: (url: string) => {
        state.opened.push(url);
        return Promise.resolve(null);
      },
    },
  };
  const code = fs.readFileSync(path.resolve(__dirname, '../../public', file), 'utf8');
  vm.runInNewContext(code, { self, Promise, JSON, String, RegExp, Object }, { filename: file });
  state.fire = async (type, event = {}) => {
    const pending: Promise<unknown>[] = [];
    const h = handlers.get(type);
    if (!h) throw new Error(`no ${type} handler`);
    h({ ...event, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    return Promise.all(pending);
  };
  return state;
}
