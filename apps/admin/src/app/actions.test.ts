// T44 متابعة: الخروج الصريح يحذف اشتراكات إشعارات الجلسة من الخادم **قبل** الخروج، ولا يتعطل لو فشل ذلك.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
const rpc = vi.fn();
const signOutAuth = vi.fn();

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc, auth: { signOut: signOutAuth } }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    calls.push(`redirect:${url}`);
  },
}));

import { signOut } from './actions';

describe('signOut (explicit)', () => {
  beforeEach(() => {
    calls.length = 0;
    rpc.mockReset().mockImplementation(async (name: string) => {
      calls.push(`rpc:${name}`);
      return { data: 1, error: null };
    });
    signOutAuth.mockReset().mockImplementation(async (opts: unknown) => {
      calls.push(`signOut:${JSON.stringify(opts)}`);
      return { error: null };
    });
  });

  it('forgets this session’s push subscriptions, then signs out locally, then goes to login', async () => {
    await signOut();
    expect(calls).toEqual([
      'rpc:forget_session_push',
      'signOut:{"scope":"local"}',
      'redirect:/login',
    ]);
  });

  it('still signs out when the push cleanup throws', async () => {
    rpc.mockRejectedValueOnce(new Error('network'));
    await signOut();
    expect(calls).toEqual(['signOut:{"scope":"local"}', 'redirect:/login']);
  });
});
