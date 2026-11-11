import { createSupabaseClient, isServerKey, type AuthStorage } from '../supabase';

const jwt = (payload: object) =>
  [
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'sig',
  ].join('.');

const ANON = jwt({ iss: 'supabase', role: 'anon' });
const SERVICE = jwt({ iss: 'supabase', role: 'service_role' });
const URL = 'http://127.0.0.1:54321';

describe('isServerKey', () => {
  it('detects service_role JWTs and sb_secret_ keys', () => {
    expect(isServerKey(SERVICE)).toBe(true);
    expect(isServerKey('sb_secret_abc123')).toBe(true);
  });

  it('accepts anon JWTs and publishable keys', () => {
    expect(isServerKey(ANON)).toBe(false);
    expect(isServerKey('sb_publishable_abc123')).toBe(false);
    expect(isServerKey('not-a-jwt')).toBe(false);
  });
});

describe('createSupabaseClient', () => {
  it('refuses a service_role or secret key', () => {
    expect(() => createSupabaseClient({ url: URL, anonKey: SERVICE })).toThrow(/service_role/);
    expect(() => createSupabaseClient({ url: URL, anonKey: 'sb_secret_x' })).toThrow(
      /service_role/,
    );
  });

  it('requires url and key', () => {
    expect(() => createSupabaseClient({ url: '', anonKey: ANON })).toThrow();
    expect(() => createSupabaseClient({ url: URL, anonKey: '' })).toThrow();
  });

  it('creates a client that uses the given storage (no network needed)', async () => {
    const saved = new Map<string, string>();
    const storage: AuthStorage = {
      getItem: (k) => saved.get(k) ?? null,
      setItem: (k, v) => {
        saved.set(k, v);
      },
      removeItem: (k) => {
        saved.delete(k);
      },
    };
    const client = createSupabaseClient({ url: URL, anonKey: ANON, storage });
    expect(typeof client.from).toBe('function');
    expect(typeof client.rpc).toBe('function');
    const { data } = await client.auth.getSession();
    expect(data.session).toBeNull();
  });
});
