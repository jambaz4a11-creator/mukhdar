// node --test: مساعدات سكربت الطوارئ لإعادة ضبط رمز الأدمن (مراجعة T16-T19 M4)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEV_PROJECT_REF,
  interactiveGuard,
  projectRef,
  randomPin,
  storedPhone,
} from './breakGlass.mjs';

test('storedPhone: accepts the usual spellings, rejects the rest', () => {
  assert.equal(storedPhone('07701234567'), '9647701234567');
  assert.equal(storedPhone('+964 770 123 4567'), '9647701234567');
  assert.equal(storedPhone('9647701234567'), '9647701234567');
  assert.equal(storedPhone('٠٧٧٠١٢٣٤٥٦٧'), '9647701234567');
  for (const bad of ['', undefined, '0770123', '08701234567', '+1 202 555 0100', 'abc'])
    assert.equal(storedPhone(bad), null, String(bad));
});

test('randomPin: 6 digits, never trivial, never from the phone', () => {
  const phone = '9647701234567';
  for (let i = 0; i < 2000; i++) {
    const pin = randomPin(phone);
    assert.match(pin, /^[0-9]{6}$/);
    const d = [...pin].map(Number);
    assert.ok(![1, 2, 3].some((p) => d.every((x, k) => x === d[k % p])), `repeat ${pin}`);
    assert.ok(![1, -1].some((s) => d.every((x, k) => k === 0 || x - d[k - 1] === s)), `run ${pin}`);
    assert.ok(!phone.startsWith(pin) && !phone.endsWith(pin), `phone ${pin}`);
  }
});

test('randomPin: retries past trivial draws', () => {
  const draws = [...'111111', ...'123456', ...'482915'].map(Number);
  let i = 0;
  assert.equal(
    randomPin(undefined, () => draws[i++]),
    '482915',
  );
});

test('projectRef: only https://<ref>.supabase.co hosts', () => {
  assert.equal(projectRef(`https://${DEV_PROJECT_REF}.supabase.co`), DEV_PROJECT_REF);
  assert.equal(projectRef('https://evil.example.com'), null);
  assert.equal(projectRef('not a url'), null);
});

test('interactiveGuard: only a real terminal on both ends', () => {
  const tty = { stdinTTY: true, stdoutTTY: true, env: {}, ref: 'prodref' };
  assert.equal(interactiveGuard(tty), null);
  for (const piped of [
    { stdinTTY: false, stdoutTTY: true }, // echo y | ...
    { stdinTTY: true, stdoutTTY: false }, // > file, | tee, script/CI capture
    { stdinTTY: false, stdoutTTY: false },
  ])
    assert.match(interactiveGuard({ ...tty, ...piped }) ?? '', /real terminal/);
});

test('interactiveGuard: CI refuses even on a terminal and even with the test escape', () => {
  const env = { CI: 'true', MUKHDAR_BREAK_GLASS_TEST: '1' };
  assert.match(
    interactiveGuard({ stdinTTY: true, stdoutTTY: true, env, ref: DEV_PROJECT_REF }) ?? '',
    /CI is set/,
  );
});

test('interactiveGuard: the test escape needs the flag AND the dev project', () => {
  const piped = { stdinTTY: false, stdoutTTY: false };
  const flag = { MUKHDAR_BREAK_GLASS_TEST: '1' };
  assert.equal(interactiveGuard({ ...piped, env: flag, ref: DEV_PROJECT_REF }), null);
  assert.notEqual(interactiveGuard({ ...piped, env: flag, ref: 'prodref' }), null);
  assert.notEqual(interactiveGuard({ ...piped, env: {}, ref: DEV_PROJECT_REF }), null);
  assert.notEqual(
    interactiveGuard({ ...piped, env: { MUKHDAR_BREAK_GLASS_TEST: 'true' }, ref: DEV_PROJECT_REF }),
    null,
  );
});
