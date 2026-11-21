// node --test: CSP بلا unsafe-inline للسكربت (T37، SPEC-webpush §6.4).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { SCRIPT_HASHES_PLACEHOLDER, applyScriptHashes, inlineScriptHashes } from './web-csp.mjs';

const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
const HEADERS = `/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'${SCRIPT_HASHES_PLACEHOLDER}; object-src 'none'\n`;

test('external scripts are not hashed; inline ones are (exact bytes)', () => {
  const html = `<script src="/a.js" defer></script><script>var a=1;</script><script type="module">\n  b()\n</script>`;
  assert.deepEqual(inlineScriptHashes(html), [sha('var a=1;'), sha('\n  b()\n')]);
});

test('JSON data blocks are not scripts and are not hashed', () => {
  assert.deepEqual(inlineScriptHashes('<script type="application/json">{"a":1}</script>'), []);
});

test('no inline scripts → script-src stays exactly self', () => {
  const out = applyScriptHashes(HEADERS, '<script src="/x.js"></script>');
  assert.match(out, /script-src 'self'; object-src/);
  assert.ok(!out.includes(SCRIPT_HASHES_PLACEHOLDER));
});

test('inline scripts → their hashes are added to script-src', () => {
  const out = applyScriptHashes(HEADERS, '<script>x()</script>');
  assert.ok(out.includes(`script-src 'self' ${sha('x()')};`), out);
});

test('missing placeholder fails loudly (headers file changed shape)', () => {
  assert.throws(() => applyScriptHashes("script-src 'self';", ''), /placeholder/);
});

test("'unsafe-inline' or 'unsafe-eval' in script-src is refused", () => {
  assert.throws(
    () => applyScriptHashes(`script-src 'self' 'unsafe-inline'${SCRIPT_HASHES_PLACEHOLDER};`, ''),
    /unsafe/,
  );
  assert.throws(
    () => applyScriptHashes(`script-src 'self' 'unsafe-eval'${SCRIPT_HASHES_PLACEHOLDER};`, ''),
    /unsafe/,
  );
});

test("style-src may keep 'unsafe-inline' (react-native-web inline styles)", () => {
  const h = `style-src 'self' 'unsafe-inline'; script-src 'self'${SCRIPT_HASHES_PLACEHOLDER};`;
  assert.doesNotThrow(() => applyScriptHashes(h, ''));
});

test('inline event handlers are refused (a hash cannot allow them)', () => {
  assert.throws(() => applyScriptHashes(HEADERS, '<body onload="x()">'), /inline event handler/);
});
