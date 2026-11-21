// خادم ساكن لـ dist (output=single) يطبّق dist/_headers مثل Cloudflare Pages، حتى تظهر أخطاء CSP فعلاً بالمتصفح.
// أي مسار بلا ملف ← index.html. يدعم قواعد _headers بالمسار الحرفي أو بنهاية "/*".
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.argv[2] ?? 3100);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
};

/** [{ pattern, headers: [[name, value]] }] من صيغة Cloudflare _headers. */
function parseHeaders(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: line.trim(), headers: [] });
    else {
      const i = line.indexOf(':');
      rules.at(-1)?.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]);
    }
  }
  return rules;
}

const rules = parseHeaders(readFileSync(join(dist, '_headers'), 'utf8'));
const matches = (pattern, path) =>
  pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -1)) : pattern === path;

createServer(async (req, res) => {
  const urlPath = new URL(req.url ?? '/', 'http://x').pathname;
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  let file = join(dist, rel);
  if (!file.startsWith(dist)) file = join(dist, 'index.html');
  try {
    if (!(await stat(file)).isFile()) throw new Error('dir');
  } catch {
    file = join(dist, 'index.html');
  }
  const headers = { 'content-type': types[extname(file)] ?? 'application/octet-stream' };
  for (const rule of rules) {
    if (!matches(rule.pattern, urlPath)) continue;
    for (const [k, v] of rule.headers) headers[k.toLowerCase()] = v;
  }
  res.writeHead(200, headers);
  res.end(await readFile(file));
}).listen(port, '127.0.0.1', () => console.log(`serving dist on http://127.0.0.1:${port}`));
