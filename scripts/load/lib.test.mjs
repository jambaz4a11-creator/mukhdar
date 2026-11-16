// node --test: الأجزاء النقية من اختبار الحمل (إحصاءات، تصنيف، عتبات، حد المعدل). بلا شبكة.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Metrics,
  RateLimiter,
  THRESHOLDS,
  classify,
  evaluate,
  percentile,
  shuffle,
} from './lib.mjs';
import { checkOversell, expectedRaceOutcome } from './checks.mjs';

test('percentile: nearest-rank', () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentile(v, 50), 50);
  assert.equal(percentile(v, 95), 95);
  assert.equal(percentile(v, 99), 99);
  assert.equal(percentile(v, 100), 100);
  assert.equal(percentile([7], 99), 7);
  assert.equal(percentile([], 50), null);
  assert.deepEqual(v.slice(0, 3), [1, 2, 3]); // لا يعدّل المدخل
});

test('classify: expected refusals are not errors, everything else is', () => {
  assert.deepEqual(classify('place_order', { status: 200, json: {} }), { kind: 'ok', code: null });
  assert.deepEqual(
    classify('place_order', { status: 400, json: { message: 'INSUFFICIENT_STOCK' } }),
    {
      kind: 'refused',
      code: 'INSUFFICIENT_STOCK',
    },
  );
  assert.deepEqual(
    classify('accept_order', { status: 400, json: { message: 'ORDER_NOT_AVAILABLE' } }),
    {
      kind: 'refused',
      code: 'ORDER_NOT_AVAILABLE',
    },
  );
  // رمز متوقع لعملية أخرى = خطأ
  assert.equal(
    classify('accept_order', { status: 400, json: { message: 'STORE_CLOSED' } }).kind,
    'error',
  );
  assert.equal(
    classify('place_order', { status: 500, json: { message: 'INSUFFICIENT_STOCK' } }).kind,
    'error',
  );
  assert.equal(classify('place_order', { status: 429, json: null }).kind, 'error');
  assert.equal(
    classify('place_order', { status: 400, json: { message: 'NOT_CUSTOMER' } }).kind,
    'error',
  );
  assert.deepEqual(classify('place_order', { status: 0, networkError: 'timeout' }), {
    kind: 'error',
    code: 'NETWORK:timeout',
  });
});

test('Metrics + evaluate: slow p95 and error rate fail, refusals do not', () => {
  const m = new Metrics();
  for (let i = 0; i < 100; i++) m.record('base', 'rpc.place_order', 100 + i, { kind: 'ok' });
  for (let i = 0; i < 30; i++)
    m.record('base', 'rpc.place_order', 120, { kind: 'refused', code: 'INSUFFICIENT_STOCK' });
  assert.deepEqual(evaluate(m.summary()).failures, []);

  const slow = new Metrics();
  for (let i = 0; i < 50; i++) slow.record('base', 'browse.products', 1500, { kind: 'ok' });
  assert.match(evaluate(slow.summary()).failures[0], /p95 1500ms > 1000ms/);

  // الذروة تحتمل أبطأ
  const spike = new Metrics();
  for (let i = 0; i < 50; i++) spike.record('spike', 'browse.products', 1500, { kind: 'ok' });
  assert.deepEqual(evaluate(spike.summary()).failures, []);

  const errs = new Metrics();
  for (let i = 0; i < 98; i++) errs.record('base', 'x', 10, { kind: 'ok' });
  for (let i = 0; i < 2; i++) errs.record('base', 'x', 10, { kind: 'error', code: 'HTTP_503' });
  assert.match(evaluate(errs.summary()).failures[0], /unexpected error rate 2\.00%/);
});

test('evaluate: tiny samples are noted, not judged; correctness/other phases ignored', () => {
  const m = new Metrics();
  for (let i = 0; i < 5; i++) m.record('base', 'rpc.rate_order', 9999, { kind: 'ok' });
  m.record('A', 'rpc.place_order', 9999, { kind: 'ok' });
  const r = evaluate(m.summary());
  assert.deepEqual(r.failures, []);
  assert.equal(r.notes.length, 1);
  assert.ok(THRESHOLDS.spike.p95Ms > THRESHOLDS.base.p95Ms);
});

test('RateLimiter: at most max per window', () => {
  let t = 0;
  const rl = new RateLimiter(3, 1000, () => t);
  for (let i = 0; i < 3; i++) {
    assert.equal(rl.waitMs(), 0);
    rl.stamps.push(t);
    t += 10;
  }
  assert.ok(rl.waitMs() > 900 && rl.waitMs() <= 1000);
  t += 1000;
  assert.equal(rl.waitMs(), 0);
});

test('shuffle keeps elements', () => {
  const a = [1, 2, 3, 4, 5];
  assert.deepEqual([...shuffle(a)].sort(), a);
});

test('checkOversell: exact accounting and no wrongful refusal', () => {
  // رصيد 7؛ نجح 3+2+2 = 7؛ الباقي رُفض والرصيد 0
  const ok = checkOversell({
    initial: 7,
    finalStock: 0,
    requests: [
      { qty: 3, result: 'OK' },
      { qty: 2, result: 'OK' },
      { qty: 2, result: 'OK' },
      { qty: 1, result: 'INSUFFICIENT_STOCK' },
      { qty: 2, result: 'INSUFFICIENT_STOCK' },
    ],
  });
  assert.deepEqual(ok, []);

  // بيع زائد
  assert.ok(
    checkOversell({ initial: 7, finalStock: -1, requests: [{ qty: 8, result: 'OK' }] }).some((e) =>
      /negative|sold/.test(e),
    ),
  );
  // رصيد لا يطابق (ضاعت وحدة)
  assert.ok(
    checkOversell({ initial: 7, finalStock: 5, requests: [{ qty: 1, result: 'OK' }] }).some((e) =>
      /balance/.test(e),
    ),
  );
  // رفض خاطئ: بقي رصيد 2 ورُفض طلب بكمية 1
  assert.ok(
    checkOversell({
      initial: 7,
      finalStock: 2,
      requests: [
        { qty: 5, result: 'OK' },
        { qty: 1, result: 'INSUFFICIENT_STOCK' },
      ],
    }).some((e) => /wrongly refused/.test(e)),
  );
  // نتيجة غير متوقعة
  assert.ok(
    checkOversell({ initial: 7, finalStock: 7, requests: [{ qty: 1, result: 'HTTP_500' }] }).some(
      (e) => /unexpected/.test(e),
    ),
  );
});

test('expectedRaceOutcome: one winner per order', () => {
  assert.deepEqual(expectedRaceOutcome(['OK', 'ORDER_NOT_AVAILABLE', 'ORDER_NOT_AVAILABLE']), []);
  assert.ok(expectedRaceOutcome(['OK', 'OK', 'ORDER_NOT_AVAILABLE']).length > 0);
  assert.ok(expectedRaceOutcome(['ORDER_NOT_AVAILABLE', 'ORDER_NOT_AVAILABLE']).length > 0);
  assert.ok(expectedRaceOutcome(['OK', 'HTTP_500']).length > 0);
});
