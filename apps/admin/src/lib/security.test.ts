import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE_MAX_AGE_S,
  STATIC_SECURITY_HEADERS,
  buildCsp,
  newNonce,
  sessionCookieOptions,
} from './security';

const REF = 'https://abcd1234.supabase.co';

describe('security headers (T23 M3)', () => {
  const byKey = Object.fromEntries(STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]));

  it('sends every header the review asks for', () => {
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
    expect(byKey['Referrer-Policy']).toBe('same-origin');
    expect(byKey['Strict-Transport-Security']).toMatch(/max-age=\d{8,}/);
    for (const feature of ['camera', 'microphone', 'geolocation']) {
      expect(byKey['Permissions-Policy']).toContain(`${feature}=()`);
    }
  });

  it('has no duplicate header names', () => {
    expect(new Set(STATIC_SECURITY_HEADERS.map((h) => h.key)).size).toBe(
      STATIC_SECURITY_HEADERS.length,
    );
  });
});

describe('buildCsp', () => {
  const csp = buildCsp({ nonce: 'NONCE123', supabaseUrl: REF });
  const dir = (name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('forbids framing, plugins, foreign <base> and foreign form targets', () => {
    expect(dir('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(dir('object-src')).toBe("object-src 'none'");
    expect(dir('base-uri')).toBe("base-uri 'self'");
    expect(dir('form-action')).toBe("form-action 'self'");
    expect(dir('default-src')).toBe("default-src 'self'");
  });

  it("scripts: same origin or this request's nonce, never unsafe-inline or unsafe-eval in production", () => {
    expect(dir('script-src')).toContain("'nonce-NONCE123'");
    expect(dir('script-src')).not.toContain('unsafe-inline');
    expect(dir('script-src')).not.toContain('unsafe-eval');
    expect(dir('script-src')).not.toMatch(/https?:\/\/\*|\*/);
  });

  it('allows eval only in development', () => {
    expect(buildCsp({ nonce: 'n', supabaseUrl: REF, dev: true })).toContain("'unsafe-eval'");
  });

  it('connects only to itself and the Supabase project (REST, Auth, Functions + Realtime websocket)', () => {
    expect(dir('connect-src')).toBe(`connect-src 'self' ${REF} wss://abcd1234.supabase.co`);
  });

  it('images: self, blob/data (upload preview) and the project Storage', () => {
    expect(dir('img-src')).toBe(`img-src 'self' blob: data: ${REF}`);
  });

  it('uses ws:// for a local http Supabase', () => {
    const local = buildCsp({ nonce: 'n', supabaseUrl: 'http://127.0.0.1:54321' });
    expect(local).toContain("connect-src 'self' http://127.0.0.1:54321 ws://127.0.0.1:54321");
  });

  it('nonces are unique and unguessable-looking', () => {
    const a = newNonce();
    const b = newNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('sessionCookieOptions (T23 M7)', () => {
  it('production: Secure, SameSite=Lax, 7 days', () => {
    expect(sessionCookieOptions(true, false)).toEqual({
      path: '/',
      sameSite: 'lax',
      secure: true,
      maxAge: SESSION_COOKIE_MAX_AGE_S,
    });
    expect(SESSION_COOKIE_MAX_AGE_S).toBe(604800);
  });
  it('development and local e2e over http: not Secure', () => {
    expect(sessionCookieOptions(false, false).secure).toBe(false);
    expect(sessionCookieOptions(true, true).secure).toBe(false);
  });
});
