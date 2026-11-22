// pnpm test:functions — R3 L5: قائمة مضيفي Web Push مكتوبة 3 مرات (قيد الجدول، register_web_push، المرسِل). هذا الفحص
// يقرأ الـ regex من ملف الـ migration نفسه ويتأكد: النسختان بالقاعدة متطابقتان، وكل ما تقبله القاعدة يقبله المرسِل
// (القاعدة أشد أو مساوية)، وendpoints الخدمات الحقيقية مقبولة بالاثنين.
import assert from 'node:assert/strict';
import { isAllowedEndpoint } from './webpush.ts';

const SQL = Deno.readTextFileSync(
  new URL('../../migrations/20261210000002_webpush_db.sql', import.meta.url),
);

function dbRegexes(): string[] {
  const out: string[] = [];
  for (const m of SQL.matchAll(/(?:token|p_endpoint) !?~ '(\^https:\/\/[^']+)'/g)) out.push(m[1]!);
  return out;
}

const REAL = [
  'https://fcm.googleapis.com/fcm/send/abc:APA91bExample-_123',
  'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABexample',
  'https://web.push.apple.com/QGexample-token_123',
  'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAexample%3d',
];

const HOSTILE = [
  'http://fcm.googleapis.com/fcm/send/x',
  'https://fcm.googleapis.com:443/fcm/send/x',
  'https://fcm.googleapis.com:8443/fcm/send/x',
  'https://user:pass@fcm.googleapis.com/fcm/send/x',
  'https://evil.com@fcm.googleapis.com/x',
  'https://fcm.googleapis.com@evil.com/x',
  'https://fcm.googleapis.com.evil.com/x',
  'https://fcm.googleapis.com./x',
  'https://FCM.googleapis.com/x',
  'https://evilfcm.googleapis.com/x',
  'https://push.apple.com/x',
  'https://evilpush.apple.com/x',
  'https://web.push.apple.com.evil.com/x',
  'https://xn--fcm-googleapis-com.evil/x',
  'https://127.0.0.1/x',
  'https://[::1]/x',
  'https://169.254.169.254/latest/meta-data',
  'https://localhost/x',
  'https://fcm.googleapis.com\\@evil.com/x',
  'https://fcm.googleapis.com/x y',
  'https://fcm.googleapis.com/é',
  'https://fcm.googleapis.com',
  'https://fcm.googleapis.com/' + 'a'.repeat(1100),
  'javascript:alert(1)',
  '',
];

Deno.test('the migration has the allowlist twice (CHECK and register_web_push), identical', () => {
  const found = dbRegexes();
  assert.equal(found.length, 2, `expected 2 regexes in the migration, found ${found.length}`);
  assert.equal(found[0], found[1]);
});

Deno.test('real push services pass both the database and the sender', () => {
  const db = new RegExp(dbRegexes()[0]!);
  for (const e of REAL) {
    assert.ok(db.test(e), `db rejects ${e}`);
    assert.ok(isAllowedEndpoint(e), `sender rejects ${e}`);
  }
});

Deno.test('the database never accepts what the sender rejects (db is the stricter copy)', () => {
  const db = new RegExp(dbRegexes()[0]!);
  for (const e of [...REAL, ...HOSTILE]) {
    const dbOk = db.test(e) && e.length <= 1024;
    if (dbOk) assert.ok(isAllowedEndpoint(e), `db accepts but sender rejects: ${e}`);
  }
  for (const e of HOSTILE) {
    assert.ok(!(db.test(e) && e.length <= 1024), `db accepts hostile endpoint: ${e}`);
  }
});
