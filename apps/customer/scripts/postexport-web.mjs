// بعد `expo export -p web`: PWA عربية RTL + CSP بهاش (T37) + فحص الأسرار. المنطق المشترك بـ scripts/web-postexport.mjs.
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { postexportWeb } from '../../../scripts/web-postexport.mjs';

postexportWeb({
  dist: join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'),
  title: 'المخضر',
  description: 'توصيل خضار وفواكه ومواد غذائية ومنظفات لمدينة بسماية',
});
process.stdout.write(
  'postexport-web: dist/index.html and dist/_headers updated, no secrets in the bundle\n',
);
