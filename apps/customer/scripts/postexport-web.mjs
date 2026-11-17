// بعد `expo export -p web`: يحوّل dist/index.html إلى PWA عربية RTL.
// (وضع output=single لا يستعمل +html.tsx، والتصيير الساكن ينهار بمكتبات الأصلي، فنعدّل القالب الناتج مباشرة.)
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const file = join(dist, 'index.html');
let html = readFileSync(file, 'utf8');

const head = `
    <meta name="description" content="توصيل خضار وفواكه لمدينة بسماية" />
    <meta name="theme-color" content="#1F6B3A" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" type="image/png" href="/icons/favicon.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="المخضر" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="format-detection" content="telephone=no" />
    <style id="mukhdar-web">
      html, body { background-color: #F7F8F3; overscroll-behavior-y: none; }
      body { -webkit-text-size-adjust: 100%; -webkit-tap-highlight-color: transparent; }
      /* iOS Safari يكبّر الصفحة عند التركيز على حقل خطه أصغر من 16px */
      input, textarea, select { font-size: 16px; }
    </style>`;

const must = (cond, msg) => {
  if (!cond) throw new Error(`postexport-web: ${msg}`);
};
must(/<html lang="en">/.test(html), 'unexpected <html> tag');
html = html.replace('<html lang="en">', '<html lang="ar" dir="rtl">');
must(/name="viewport"[^>]*\/>/.test(html), 'viewport meta not found');
html = html.replace(/(name="viewport" content=")([^"]*)(")/, '$1$2, viewport-fit=cover$3');
html = html.replace('<link rel="icon" href="/favicon.ico"/>', '');
must(html.includes('</head>'), '</head> not found');
html = html.replace('</head>', `${head}\n  </head>`);
html = html.replace(
  '<noscript> You need to enable JavaScript to run this app. </noscript>',
  '<noscript>يلزم تفعيل جافاسكربت لتشغيل التطبيق.</noscript>',
);
writeFileSync(file, html);
process.stdout.write('postexport-web: dist/index.html updated\n');
