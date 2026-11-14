import { AuthApiError, AuthRetryableFetchError, FunctionsFetchError } from '@supabase/supabase-js';
import { AUTH_MESSAGES, authError } from '../auth-errors';
import { DEFAULT_ERROR_MESSAGE, ERROR_MESSAGES, NETWORK_ERROR_MESSAGE } from '../errors';

describe('authError (one map for sign-in and sign-up errors)', () => {
  it('wrong phone or PIN → the same message for both', () => {
    const e = new AuthApiError('Invalid login credentials', 400, 'invalid_credentials');
    expect(authError(e)).toEqual({
      kind: 'invalid_credentials',
      message: AUTH_MESSAGES.INVALID_CREDENTIALS,
    });
    expect(AUTH_MESSAGES.INVALID_CREDENTIALS).toBe('الرقم أو الرمز غير صحيح');
  });

  it.each(['PHONE_TAKEN', 'user_already_exists', 'phone_exists'])(
    '%s → "registered, sign in" (phone_taken)',
    (code) => {
      expect(authError(code)).toEqual({ kind: 'phone_taken', message: ERROR_MESSAGES.PHONE_TAKEN });
      expect(authError({ code, message: 'x' }).kind).toBe('phone_taken');
    },
  );

  it('rate limits: signup RATE_LIMITED, GoTrue over_request_rate_limit, any 429', () => {
    expect(authError({ error: 'RATE_LIMITED' }).kind).toBe('rate_limited');
    expect(authError(new AuthApiError('x', 429, 'over_request_rate_limit')).kind).toBe(
      'rate_limited',
    );
    expect(authError({ status: 429, message: 'Too many requests' })).toEqual({
      kind: 'rate_limited',
      message: AUTH_MESSAGES.RATE_LIMITED,
    });
  });

  it('weak_password → PIN length message', () => {
    expect(authError(new AuthApiError('weak', 422, 'weak_password')).message).toBe(
      AUTH_MESSAGES.PIN_LENGTH,
    );
  });

  it('other signup codes use errors.ts messages (BackendError from parseFunctionError too)', () => {
    expect(authError({ code: 'PIN_INVALID', message: '…', detail: null }).message).toBe(
      ERROR_MESSAGES.PIN_INVALID,
    );
    expect(authError('PHONE_INVALID').message).toBe(ERROR_MESSAGES.PHONE_INVALID);
  });

  it('network failures', () => {
    expect(authError(new AuthRetryableFetchError('Failed to fetch', 0)).kind).toBe('network');
    expect(authError(new FunctionsFetchError(new Error('x'))).kind).toBe('network');
    expect(authError({ code: null, message: NETWORK_ERROR_MESSAGE, detail: null }).kind).toBe(
      'network',
    );
  });

  it('anything else → generic message, never the raw text', () => {
    const r = authError(
      new AuthApiError('Database error saving new user', 500, 'unexpected_failure'),
    );
    expect(r).toEqual({ kind: 'other', message: DEFAULT_ERROR_MESSAGE });
    expect(authError(undefined).message).toBe(DEFAULT_ERROR_MESSAGE);
  });
});
