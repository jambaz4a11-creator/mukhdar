// node --test: حارس pnpm sb (H1)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEV_PROJECT_REFS } from './db.mjs';
import { plan, classifyRef, isReadOnly, dbUrls, PROD_PROJECT_REFS } from './sb.mjs';

const dev = { ref: DEV_PROJECT_REFS[0], name: 'mukhdar-dev' };
const PROD = 'abcdefghijklmnopqrst';
const OTHER = 'zzzzzzzzzzzzzzzzzzzz';

test('dev ref is allowed with a DEV banner', () => {
  const p = plan(['db', 'push', '--remote', '--yes'], { linked: dev, env: {} });
  assert.equal(p.action, 'run');
  assert.match(p.banner, /^TARGET: DEV mukhdar-dev/);
  assert.ok(p.args.includes('--yes'));
});

test('unknown linked ref is refused, even for read-only commands', () => {
  for (const args of [
    ['db', 'push'],
    ['migration', 'list', '--remote'],
    ['functions', 'deploy', 'x'],
  ]) {
    const p = plan(args, { linked: { ref: OTHER, name: 'other' }, env: {} });
    assert.equal(p.action, 'refuse');
    assert.match(p.reason, /not in DEV_PROJECT_REFS/);
  }
});

test('the shipped prod placeholder is refused (not a valid ref)', () => {
  assert.equal(classifyRef(PROD_PROJECT_REFS[0]), 'placeholder');
  const p = plan(['db', 'push'], {
    linked: { ref: PROD_PROJECT_REFS[0], name: 'x' },
    env: { MUKHDAR_TARGET: 'prod' },
  });
  assert.equal(p.action, 'refuse');
  assert.match(p.reason, /placeholder/);
});

test('no linked project: refused except for commands that need none', () => {
  assert.equal(plan(['db', 'push'], { linked: undefined, env: {} }).action, 'refuse');
  assert.equal(plan(['login'], { linked: undefined, env: {} }).action, 'run');
});

test('link validates the requested ref', () => {
  assert.equal(
    plan(['link', '--project-ref', dev.ref], { linked: undefined, env: {} }).action,
    'run',
  );
  assert.equal(plan(['link', '--project-ref', OTHER], { linked: dev, env: {} }).action, 'refuse');
});

test('an explicit ref that differs from the linked one is refused', () => {
  const p = plan(['functions', 'deploy', 'signup', `--remote=${PROD}`], { linked: dev, env: {} });
  assert.equal(p.action, 'refuse');
  assert.match(p.reason, /differs/);
});

test('prod ref (when registered): read-only runs, mutating needs MUKHDAR_TARGET + typed ref, --yes stripped', () => {
  PROD_PROJECT_REFS.push(PROD);
  try {
    const linked = { ref: PROD, name: 'whatever' };
    const ro = plan(['db', 'push', '--remote', '--dry-run'], { linked, env: {} });
    assert.equal(ro.action, 'run');
    assert.match(ro.banner, /\*\*\* PRODUCTION \*\*\* mukhdar-prod/);
    assert.equal(ro.confirmRef, undefined);

    const noEnv = plan(['db', 'push', '--remote', '--yes'], { linked, env: {} });
    assert.equal(noEnv.action, 'refuse');
    assert.match(noEnv.reason, /MUKHDAR_TARGET=prod/);

    const ok = plan(['db', 'push', '--remote', '--yes'], {
      linked,
      env: { MUKHDAR_TARGET: 'prod' },
    });
    assert.equal(ok.action, 'run');
    assert.equal(ok.confirmRef, PROD);
    assert.ok(!ok.args.includes('--yes'));
  } finally {
    PROD_PROJECT_REFS.pop();
  }
});

// T23 L5: --db-url يتجاوز الربط، و--dry-run لا يُصدَّق إلا للأوامر التي تدعمه
test('--db-url must belong to the target project', () => {
  const same = `postgresql://postgres.${dev.ref}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
  const direct = `postgresql://postgres:pw@db.${dev.ref}.supabase.co:5432/postgres`;
  const prodUrl = `postgresql://postgres.${PROD}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
  const local = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  for (const u of [same, direct]) {
    assert.equal(plan(['db', 'push', '--db-url', u], { linked: dev, env: {} }).action, 'run');
    assert.equal(plan(['db', 'push', `--db-url=${u}`], { linked: dev, env: {} }).action, 'run');
  }
  for (const u of [prodUrl, local, '']) {
    for (const args of [
      ['db', 'push', '--db-url', u],
      ['db', 'push', `--db-url=${u}`],
    ]) {
      const p = plan(args, { linked: dev, env: {} });
      assert.equal(p.action, 'refuse', args.join(' '));
    }
  }
  assert.match(
    plan(['db', 'push', '--db-url', prodUrl], { linked: dev, env: {} }).reason,
    /not the target/,
  );
  assert.match(
    plan(['db', 'push', '--db-url', local], { linked: dev, env: {} }).reason,
    /could not be tied/,
  );
  assert.deepEqual(dbUrls(['db', 'push', '--db-url', 'a', '--db-url=b']), ['a', 'b']);
});

test('--db-url naming the production project is refused even while linked to prod without the env var', () => {
  PROD_PROJECT_REFS.push(PROD);
  try {
    const linked = { ref: PROD, name: 'x' };
    const url = `postgresql://postgres.${PROD}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
    assert.equal(plan(['db', 'push', '--db-url', url], { linked, env: {} }).action, 'refuse');
    // ربط الإنتاج لكن الرابط لمشروع التطوير: خلط
    const devUrl = `postgresql://postgres.${dev.ref}:pw@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
    assert.match(
      plan(['db', 'push', '--db-url', devUrl], { linked, env: { MUKHDAR_TARGET: 'prod' } }).reason,
      /not the target/,
    );
  } finally {
    PROD_PROJECT_REFS.pop();
  }
});

test('--dry-run counts as read-only only for commands that support it', () => {
  assert.equal(isReadOnly(['db', 'push', '--dry-run']), true);
  assert.equal(isReadOnly(['db', 'push', '--remote', '--dry-run']), true);
  assert.equal(isReadOnly(['migration', 'up', '--dry-run']), true);
  for (const args of [
    ['functions', 'deploy', 'x', '--dry-run'],
    ['secrets', 'set', 'A=b', '--dry-run'],
    ['db', 'reset', '--dry-run'],
    ['db', 'push'],
  ]) {
    assert.equal(isReadOnly(args), false, args.join(' '));
  }
});

test('on production, --dry-run on a command that does not support it still needs MUKHDAR_TARGET', () => {
  PROD_PROJECT_REFS.push(PROD);
  try {
    const linked = { ref: PROD, name: 'x' };
    const p = plan(['functions', 'deploy', 'signup', '--dry-run'], { linked, env: {} });
    assert.equal(p.action, 'refuse');
    assert.match(p.reason, /MUKHDAR_TARGET=prod/);
    assert.equal(plan(['db', 'push', '--dry-run'], { linked, env: {} }).action, 'run');
  } finally {
    PROD_PROJECT_REFS.pop();
  }
});

function runCli(args, linkedJson, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-'));
  fs.mkdirSync(path.join(dir, 'supabase', '.temp'), { recursive: true });
  if (linkedJson) {
    fs.writeFileSync(
      path.join(dir, 'supabase', '.temp', 'linked-project.json'),
      JSON.stringify(linkedJson),
    );
  }
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'sb.mjs'), ...args], {
    env: { ...process.env, MUKHDAR_SB_ROOT: dir, MUKHDAR_SB_DRYRUN: '1', ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

test('CLI: dev prints the banner and would run; unknown and placeholder exit 2', () => {
  const d = runCli(['db', 'push', '--dry-run'], dev);
  assert.equal(d.status, 0);
  assert.match(d.stderr, /TARGET: DEV mukhdar-dev/);
  assert.match(d.stdout, /WOULD RUN: supabase db push --dry-run/);

  const u = runCli(['db', 'push'], { ref: OTHER, name: 'x' });
  assert.equal(u.status, 2);
  assert.match(u.stderr, /REFUSED/);

  const ph = runCli(
    ['db', 'push'],
    { ref: PROD_PROJECT_REFS[0], name: 'x' },
    { MUKHDAR_TARGET: 'prod' },
  );
  assert.equal(ph.status, 2);
  assert.match(ph.stderr, /placeholder/);
});
