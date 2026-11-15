import { describe, expect, it } from 'vitest';
import { readPublicEnv } from './env';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (role: string) => `${b64({ alg: 'HS256' })}.${b64({ role })}.sig`;

describe('readPublicEnv (no service_role in the admin panel)', () => {
  it('accepts a publishable or anon key', () => {
    expect(readPublicEnv('https://x.supabase.co', 'sb_publishable_abc').key).toBe(
      'sb_publishable_abc',
    );
    expect(readPublicEnv('https://x.supabase.co', jwt('anon')).url).toBe('https://x.supabase.co');
  });

  it('refuses a server key', () => {
    expect(() => readPublicEnv('https://x.supabase.co', 'sb_secret_abc')).toThrow(/server key/);
    expect(() => readPublicEnv('https://x.supabase.co', jwt('service_role'))).toThrow(/server key/);
  });

  it('requires both values', () => {
    expect(() => readPublicEnv('', 'sb_publishable_abc')).toThrow(/required/);
    expect(() => readPublicEnv('https://x.supabase.co', undefined)).toThrow(/required/);
  });
});
