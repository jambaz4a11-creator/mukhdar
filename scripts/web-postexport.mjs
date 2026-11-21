// المعالجة المشتركة بعد `expo export -p web` (الزبون T21، السائق T37). وضع output=single لا يستعمل +html.tsx،
// والتصيير الساكن ينهار بمكتبات الأصلي، فنعدّل القالب الناتج مباشرة:
//   1) dist/index.html: عربي RTL، viewport-fit=cover (المناطق الآمنة: SafeAreaView يقرأ env(safe-area-inset-*))،
//      manifest وأيقونات ووسوم iOS.
//   2) dist/_headers: هاشات السكربتات الداخلية بدل العلامة (CSP بلا 'unsafe-inline' للسكربت، SPEC-webpush §6.4).
//   3) فحص الأسرار بكل dist (check-web-bundle.mjs).
// أي موضع تعديل مفقود ← خطأ يوقف البناء (لا نشر لصفحة نصف معدَّلة).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { scanDir } from './check-web-bundle.mjs';
import { applyScriptHashes } from './web-csp.mjs';

const escapeAttr = (s) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const must = (cond, msg) => {
  if (!cond) throw new Error(`postexport-web: ${msg}`);
};

export function transformIndexHtml(html, { title, description }) {
  const head = `
    <meta name="description" content="${escapeAttr(description)}" />
    <meta name="theme-color" content="#1F6B3A" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" type="image/png" href="/icons/favicon.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="${escapeAttr(title)}" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="format-detection" content="telephone=no" />
    <style id="mukhdar-web">
      html, body { background-color: #F7F8F3; overscroll-behavior-y: none; }
      body { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
      /* iOS Safari يكبّر الصفحة عند التركيز على حقل خطه أصغر من 16px */
      input, textarea, select { font-size: 16px; }
    </style>`;

  let out = html;
  must(/<html lang="en">/.test(out), 'unexpected <html> tag');
  out = out.replace('<html lang="en">', '<html lang="ar" dir="rtl">');
  must(/name="viewport" content="[^"]*"/.test(out), 'viewport meta not found');
  out = out.replace(/(name="viewport" content=")([^"]*)(")/, '$1$2, viewport-fit=cover$3');
  out = out.replace('<link rel="icon" href="/favicon.ico"/>', '');
  must(out.includes('</head>'), '</head> not found');
  out = out.replace('</head>', `${head}\n  </head>`);
  out = out.replace(
    '<noscript> You need to enable JavaScript to run this app. </noscript>',
    '<noscript>يلزم تفعيل جافاسكربت لتشغيل التطبيق.</noscript>',
  );
  return out;
}

export function postexportWeb({ dist, title, description, env = process.env }) {
  const indexFile = join(dist, 'index.html');
  const headersFile = join(dist, '_headers');
  must(
    existsSync(headersFile),
    'dist/_headers missing (public/_headers not copied by expo export)',
  );

  const html = transformIndexHtml(readFileSync(indexFile, 'utf8'), { title, description });
  writeFileSync(indexFile, html);
  writeFileSync(headersFile, applyScriptHashes(readFileSync(headersFile, 'utf8'), html));

  const findings = scanDir(dist, env);
  if (findings.length > 0) {
    throw new Error(`postexport-web: SECRET FOUND in the web bundle:\n  ${findings.join('\n  ')}`);
  }
}
