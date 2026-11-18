// التحقق من رخصة الصورة من المصدر (Openverse/Commons) وتوليد جدول المصادر. بلا آثار جانبية (يُختبر بـ sources.test.mjs).
export const UA = 'mukhdar-product-images/1.0 (catalog tooling)';

const COMMONS_OK = /^(cc0|cc zero|public domain|pd[- ])/i;

/** يتحقق من رخصة الصورة من المصدر الآن (لا نثق بما كُتب بالـ manifest): يرجع نص الرخصة أو يرمي. */
export async function verifyLicense(entry, fetcher = fetch) {
  if (entry.source === 'openverse') {
    const r = await fetcher(`https://api.openverse.org/v1/images/${entry.id}/`, {
      headers: { 'User-Agent': UA },
    });
    if (!r.ok) throw new Error(`license check failed (${r.status})`);
    const j = await r.json();
    if (!['cc0', 'pdm'].includes(j.license)) throw new Error(`license ${j.license} is not CC0/PDM`);
    return `${j.license} ${j.license_version ?? ''}`.trim();
  }
  if (entry.source === 'commons') {
    const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=extmetadata&titles=${encodeURIComponent(entry.id)}`;
    const r = await fetcher(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) throw new Error(`license check failed (${r.status})`);
    const page = Object.values((await r.json()).query?.pages ?? {})[0];
    const lic = page?.imageinfo?.[0]?.extmetadata?.LicenseShortName?.value ?? '';
    if (!COMMONS_OK.test(lic)) throw new Error(`license "${lic}" is not CC0/public domain`);
    return lic;
  }
  throw new Error(`unknown source ${entry.source}`);
}

export function sourcesMarkdown(entries) {
  const rows = entries.map(
    (e) =>
      `| ${e.product} | ${e.title ?? ''} | [${e.source}](${e.landing}) | ${e.license} ([text](${e.licenseUrl || e.landing})) | ${e.creator || '—'} |`,
  );
  return [
    '# Product image sources',
    '',
    'Only images that are CC0 or public domain (no attribution required) are used. Each entry was',
    'license-checked against the source API when the script ran (`scripts/product-images/run.mjs`).',
    'Attribution is not required; the creator is listed for transparency.',
    '',
    '| Product | Title | Source page | License | Creator |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}
