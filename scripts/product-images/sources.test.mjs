import assert from 'node:assert/strict';
import test from 'node:test';
import { sourcesMarkdown, verifyLicense } from './sources.mjs';

const reply =
  (body, ok = true) =>
  async () => ({ ok, status: ok ? 200 : 500, json: async () => body });

test('openverse: only cc0 / pdm pass', async () => {
  const e = { source: 'openverse', id: 'x' };
  assert.equal(
    await verifyLicense(e, reply({ license: 'cc0', license_version: '1.0' })),
    'cc0 1.0',
  );
  assert.equal(
    await verifyLicense(e, reply({ license: 'pdm', license_version: '1.0' })),
    'pdm 1.0',
  );
  await assert.rejects(
    verifyLicense(e, reply({ license: 'by', license_version: '4.0' })),
    /not CC0/,
  );
  await assert.rejects(verifyLicense(e, reply({}, false)), /license check failed/);
});

test('commons: only CC0 / public domain pass (CC BY, CC BY-SA refused)', async () => {
  const e = { source: 'commons', id: 'File:A.jpg' };
  const lic = (v) =>
    reply({
      query: { pages: { 1: { imageinfo: [{ extmetadata: { LicenseShortName: { value: v } } }] } } },
    });
  assert.equal(await verifyLicense(e, lic('CC0')), 'CC0');
  assert.equal(await verifyLicense(e, lic('Public domain')), 'Public domain');
  await assert.rejects(verifyLicense(e, lic('CC BY-SA 4.0')), /not CC0/);
  await assert.rejects(verifyLicense(e, lic('CC BY 2.0')), /not CC0/);
  await assert.rejects(verifyLicense(e, reply({ query: { pages: {} } })), /not CC0/);
});

test('unknown source is refused; markdown lists product, source and license', async () => {
  await assert.rejects(verifyLicense({ source: 'google', id: 'x' }), /unknown source/);
  const md = sourcesMarkdown([
    {
      product: 'طماطة',
      title: 'Tomato',
      source: 'commons',
      landing: 'https://c/x',
      license: 'CC0',
      licenseUrl: '',
      creator: 'A',
    },
  ]);
  assert.match(md, /\| طماطة \| Tomato \| \[commons\]\(https:\/\/c\/x\) \| CC0/);
});
