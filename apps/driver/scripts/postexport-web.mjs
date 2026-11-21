// بعد `expo export -p web` (T37): PWA عربية RTL + CSP بهاش + فحص الأسرار. المنطق المشترك بـ scripts/web-postexport.mjs.
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { postexportWeb } from '../../../scripts/web-postexport.mjs';

postexportWeb({
  dist: join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
  title: 'سائق المخضر',
  description: 'تطبيق سائقي المخضر لتوصيل الطلبات في بسماية',
});
process.stdout.write(
  'postexport-web: dist/index.html and dist/_headers updated, no secrets in the bundle\n',
);
