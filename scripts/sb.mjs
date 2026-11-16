// pnpm sb <أمر supabase>: الطريقة الوحيدة الموثّقة لاستدعاء الـ CLI للعمل السحابي (H1).
//   pnpm sb db push --remote --dry-run
// يطبع لافتة DEV / PRODUCTION كبيرة أولاً، ويرفض أي مشروع خارج القائمتين الصريحتين.
// للإنتاج: MUKHDAR_TARGET=prod + كتابة الـ ref يدوياً (طرفية حقيقية فقط).
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { root } from './lib/db.mjs';
import { plan, readLinked } from './lib/sb.mjs';

const args = process.argv.slice(2);
const rootDir = process.env.MUKHDAR_SB_ROOT ?? root;
const p = plan(args, { linked: readLinked(rootDir), env: process.env });

const bar = '='.repeat(60);
function banner(text, prod) {
  const style = prod ? '\x1b[41m\x1b[97m' : '\x1b[42m\x1b[30m';
  console.error(`\n${style}${bar}\n  ${text}\n${bar}\x1b[0m\n`);
}

if (p.banner) banner(p.banner, p.kind === 'prod');
if (p.action === 'refuse') {
  console.error(`sb: REFUSED. ${p.reason}`);
  process.exit(2);
}

if (p.confirmRef) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error('sb: REFUSED. Production needs an interactive terminal to type the project ref.');
    process.exit(2);
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise((r) =>
    rl.question(`Type the project ref (${p.confirmRef}) to continue: `, r),
  );
  rl.close();
  if (answer.trim() !== p.confirmRef) {
    console.error('sb: REFUSED. Confirmation does not match.');
    process.exit(2);
  }
}

if (process.env.MUKHDAR_SB_DRYRUN === '1') {
  console.log(`WOULD RUN: supabase ${p.args.join(' ')}`);
  process.exit(0);
}

const r = spawnSync('pnpm', ['exec', 'supabase', ...p.args], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(r.status ?? 1);
