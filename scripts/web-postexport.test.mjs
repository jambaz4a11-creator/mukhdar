// node --test: المعالجة المشتركة بعد `expo export -p web` لتطبيقَي الزبون والسائق (T37).
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SCRIPT_HASHES_PLACEHOLDER } from './web-csp.mjs';
import { postexportWeb, transformIndexHtml } from './web-postexport.mjs';

// نفس شكل قالب Expo SDK 58 (output: single)
const EXPO_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
    <title>x</title>
  <link rel="icon" href="/favicon.ico"/></head>
  <body>
    <noscript> You need to enable JavaScript to run this app. </noscript>
    <div id="root"></div>
  <script src="/_expo/static/js/web/entry-1.js" defer></script>
</body>
</html>`;

const APP = { title: 'سائق المخضر', description: 'تطبيق سائقي المخضر' };

test('html: Arabic RTL, viewport-fit, manifest, iOS meta', () => {
  const out = transformIndexHtml(EXPO_HTML, APP);
  assert.match(out, /<html lang="ar" dir="rtl">/);
  assert.match(out, /viewport-fit=cover/);
  assert.match(out, /<link rel="manifest" href="\/manifest.webmanifest" \/>/);
  assert.match(out, /<link rel="apple-touch-icon" href="\/icons\/apple-touch-icon.png" \/>/);
  assert.match(out, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(out, /apple-mobile-web-app-title" content="سائق المخضر"/);
  assert.match(out, /name="description" content="تطبيق سائقي المخضر"/);
  assert.ok(!out.includes('/favicon.ico'));
  assert.match(out, /<noscript>يلزم تفعيل جافاسكربت/);
});

test('html: missing anchors fail loudly', () => {
  assert.throws(
    () => transformIndexHtml(EXPO_HTML.replace('lang="en"', 'lang="fr"'), APP),
    /<html>/,
  );
  assert.throws(
    () => transformIndexHtml(EXPO_HTML.replace('name="viewport"', 'name="vp"'), APP),
    /viewport/,
  );
  assert.throws(() => transformIndexHtml(EXPO_HTML.replace('</head>', ''), APP), /<\/head>/);
});

test('html: titles with HTML-special characters are escaped', () => {
  const out = transformIndexHtml(EXPO_HTML, { title: 'a"<b', description: 'd&e' });
  assert.match(out, /content="a&quot;&lt;b"/);
  assert.match(out, /content="d&amp;e"/);
});

function makeDist(headers, html = EXPO_HTML) {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(dist, 'index.html'), html);
  writeFileSync(join(dist, '_headers'), headers);
  return dist;
}

test('postexportWeb: rewrites index.html and fills the CSP placeholder in dist/_headers', () => {
  const dist = makeDist(
    `/*\n  Content-Security-Policy: script-src 'self'${SCRIPT_HASHES_PLACEHOLDER}; object-src 'none'\n`,
  );
  try {
    postexportWeb({ dist, ...APP, env: {} });
    assert.match(readFileSync(join(dist, 'index.html'), 'utf8'), /dir="rtl"/);
    const headers = readFileSync(join(dist, '_headers'), 'utf8');
    assert.match(headers, /script-src 'self'; object-src 'none'/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('postexportWeb: a secret in the bundle fails the build', () => {
  const dist = makeDist(`script-src 'self'${SCRIPT_HASHES_PLACEHOLDER};`);
  writeFileSync(join(dist, 'leak.js'), 'k="sb_secret_AbCdEf0123456789xyzXYZ"');
  try {
    assert.throws(() => postexportWeb({ dist, ...APP, env: {} }), /secret/i);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test('postexportWeb: missing dist/_headers fails (public/_headers not copied)', () => {
  const dist = mkdtempSync(join(tmpdir(), 'dist-'));
  writeFileSync(join(dist, 'index.html'), EXPO_HTML);
  try {
    assert.throws(() => postexportWeb({ dist, ...APP, env: {} }), /_headers/);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
