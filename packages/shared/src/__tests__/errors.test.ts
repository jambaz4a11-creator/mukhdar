import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_ERROR_MESSAGE,
  ERROR_CODES,
  ERROR_MESSAGES,
  NETWORK_ERROR_MESSAGE,
  errorMessage,
  parseBackendError,
  parseFunctionError,
} from '../errors';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

const repo = path.resolve(__dirname, '../../../..');

/** رموز الأخطاء بقسم دوال RPC (§5) بـ SPEC-backend: كل `UPPER_CASE` بين علامتي backtick. */
function specCodes(): string[] {
  const spec = fs.readFileSync(path.join(repo, 'docs', 'SPEC-backend.md'), 'utf8');
  const start = spec.indexOf('## 5)');
  const end = spec.indexOf('## 6)');
  if (start < 0 || end < start) throw new Error('SPEC-backend §5 not found');
  const codes = [...spec.slice(start, end).matchAll(/`([A-Z]+(?:_[A-Z]+)+)`/g)].map(
    (m) => m[1] as string,
  );
  return [...new Set(codes)].sort();
}

/** كل رمز ترفعه قاعدة البيانات: raise exception 'CODE' بملفات migrations. */
function sqlCodes(): string[] {
  const dir = path.join(repo, 'supabase', 'migrations');
  const codes = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .flatMap((f) => [
      ...fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/raise exception '([A-Z_]+)'/g),
    ])
    .map((m) => m[1] as string);
  return [...new Set(codes)].sort();
}

describe('error codes', () => {
  it('reads the codes from SPEC-backend, including the newest ones', () => {
    expect(specCodes().length).toBeGreaterThanOrEqual(25);
    expect(specCodes()).toEqual(
      expect.arrayContaining([
        'PHONE_REQUIRED',
        'TOO_MANY_ACTIVE_ORDERS',
        'ADDRESS_INACTIVE',
        'INVALID_TOKEN',
      ]),
    );
  });

  it('SPEC-backend §5 documents exactly the codes the SQL raises', () => {
    expect(specCodes()).toEqual(sqlCodes());
  });

  it.each(specCodes())('%s has an Arabic message in errors.ts', (code) => {
    expect(ERROR_MESSAGES).toHaveProperty(code);
    expect(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]).toMatch(/[؀-ۿ]/);
  });

  it('errors.ts has no codes the backend does not document', () => {
    expect([...ERROR_CODES].sort()).toEqual(specCodes());
  });
});

describe('parseBackendError', () => {
  it('maps a PostgREST error (code in message, product id in details)', () => {
    expect(
      parseBackendError({ message: 'INSUFFICIENT_STOCK', code: 'P0001', details: 'abc-123' }),
    ).toEqual({
      code: 'INSUFFICIENT_STOCK',
      message: ERROR_MESSAGES.INSUFFICIENT_STOCK,
      detail: 'abc-123',
    });
  });

  it('maps an Edge Function error body {error: CODE} (delete-account)', () => {
    expect(parseBackendError({ error: 'ACTIVE_ORDER' })).toEqual({
      code: 'ACTIVE_ORDER',
      message: ERROR_MESSAGES.ACTIVE_ORDER,
      detail: null,
    });
    expect(parseBackendError({ error: 'delete failed' }).message).toBe(DEFAULT_ERROR_MESSAGE);
    expect(parseBackendError({ error: 'nope', message: 'ADMIN_ACCOUNT' }).code).toBe(
      'ADMIN_ACCOUNT',
    );
  });

  it('parseFunctionError reads the code from a functions.invoke error (S6)', async () => {
    const http = new FunctionsHttpError(Response.json({ error: 'ACTIVE_ORDER' }, { status: 409 }));
    // بدون القراءة غير المتزامنة: الرسالة العامة فقط
    expect(parseBackendError(http).code).toBeNull();
    expect(await parseFunctionError(http)).toEqual({
      code: 'ACTIVE_ORDER',
      message: ERROR_MESSAGES.ACTIVE_ORDER,
      detail: null,
    });
    const notJson = new FunctionsHttpError(new Response('<html>502</html>', { status: 502 }));
    expect((await parseFunctionError(notJson)).message).toBe(DEFAULT_ERROR_MESSAGE);
    expect((await parseFunctionError(new FunctionsFetchError(new TypeError('x')))).message).toBe(
      NETWORK_ERROR_MESSAGE,
    );
    expect((await parseFunctionError('ADMIN_ACCOUNT')).code).toBe('ADMIN_ACCOUNT');
  });

  it('maps a bare code string', () => {
    expect(errorMessage('TOO_MANY_ACTIVE_ORDERS')).toBe(ERROR_MESSAGES.TOO_MANY_ACTIVE_ORDERS);
  });

  it('maps network failures to the network message', () => {
    expect(errorMessage(new TypeError('Network request failed'))).toBe(NETWORK_ERROR_MESSAGE);
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE);
  });

  it.each([
    [{ message: 'permission denied for table orders', code: '42501' }],
    [new Error('something odd')],
    [null],
    [undefined],
    [42],
    ['constructor'],
    ['toString'],
  ])('falls back to the default message for %p, never the raw text', (input) => {
    expect(parseBackendError(input)).toEqual({
      code: null,
      message: DEFAULT_ERROR_MESSAGE,
      detail: null,
    });
  });
});
