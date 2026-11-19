import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveImageTarget } from '../product-images/guard.mjs';
import { addressProblems, buildingNumbers, validateData, wantedSectors } from './lib.mjs';

const data = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'data.json'), 'utf8'));

test('data.json is valid and has exactly the 13 blocks from the owner', () => {
  validateData(data);
  const counts = Object.fromEntries(data.blocks.map((b) => [b.name, b.buildings]));
  assert.deepEqual(counts, {
    A1: 12,
    A2: 14,
    A3: 14,
    A4: 12,
    A5: 12,
    A6: 12,
    A7: 13,
    A8: 15,
    A9: 15,
    B1: 12,
    B2: 18,
    B3: 18,
    B8: 12,
  });
  assert.deepEqual(wantedSectors(data), ['قطاع A', 'قطاع B']);
  for (const hidden of ['B4', 'B5', 'B6', 'B7']) assert.ok(!(hidden in counts));
});

test('validateData rejects bad input', () => {
  const clone = () => structuredClone(data);
  let d = clone();
  d.blocks.push({ sector: 'قطاع B', name: 'B8', buildings: 3 });
  assert.throws(() => validateData(d), /duplicate/);
  d = clone();
  d.blocks[0].buildings = 101;
  assert.throws(() => validateData(d), /1\.\.100/);
  d = clone();
  d.blocks[0].sector = 'قطاع B';
  assert.throws(() => validateData(d), /does not belong/);
  d = clone();
  d.floors.max = 20;
  assert.throws(() => validateData(d), /floors/);
  assert.throws(() => validateData({ city: 'x', blocks: [] }), /non-empty/);
});

test('buildingNumbers gives 1..n as text', () => {
  assert.deepEqual(buildingNumbers(3), ['1', '2', '3']);
});

test('addressProblems flags every invalid case and passes a valid one', () => {
  const ok = {
    floor: 0,
    apartment: '12',
    building_active: true,
    block_active: true,
    sector_active: true,
  };
  assert.deepEqual(addressProblems(ok), []);
  assert.deepEqual(addressProblems({ ...ok, floor: 9, apartment: '1' }), []);
  assert.match(addressProblems({ ...ok, floor: null })[0], /floor missing/);
  assert.match(addressProblems({ ...ok, floor: 10 })[0], /outside/);
  assert.match(addressProblems({ ...ok, apartment: '13' })[0], /apartment/);
  assert.match(addressProblems({ ...ok, apartment: '٥' })[0], /apartment/);
  assert.match(addressProblems({ ...ok, block_active: false })[0], /block hidden/);
  assert.match(addressProblems({ ...ok, building_active: false })[0], /building not in block/);
});

test('the script refuses production unless explicitly targeted (same guard as the image script)', () => {
  const prod = {
    kind: 'remote',
    projectRef: 'abcdefghijklmnopqrst',
    poolerUrl:
      'postgresql://postgres.abcdefghijklmnopqrst:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres',
  };
  // بلا --target=prod يمرّ على حارس التطوير ويرفض أي مشروع غير التطوير
  assert.throws(() => resolveImageTarget(prod, ['--remote'], {}), /Refusing/);
  assert.throws(
    () => resolveImageTarget(prod, ['--remote', '--target=prod'], {}, { prod: [prod.projectRef] }),
    /MUKHDAR_TARGET/,
  );
});
