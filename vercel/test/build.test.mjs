import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';

async function moduleUnderTest() {
  const module = await import('../scripts/build.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof module.downloadWidget, 'function', 'pinned widget downloader exists');
  return module;
}

test('widget downloader pins version and integrity; failed or altered assets cannot build', async () => {
  const { downloadWidget, WIDGET_URL, WIDGET_SHA256 } = await moduleUnderTest();
  assert.equal(WIDGET_URL, 'https://cdn.jsdelivr.net/npm/@inkeep/agents-ui-js-cloud@0.17.8/dist/embed.js');
  assert.equal(WIDGET_SHA256, '8c75de39e4d2d82d4e0307bc82cf73bf252f5c9489a7794674811a9ac2307366');
  for (const status of [200, 302, 404]) {
    await assert.rejects(downloadWidget({ fetchImpl: async (url, init) => {
      assert.equal(url, WIDGET_URL);
      assert.equal(init.redirect, 'manual');
      return new Response('not the official widget', { status });
    } }), /widget/i);
  }
});

test('build requires the operator-supplied screenshot before writing a widget', async () => {
  const { build } = await moduleUnderTest();
  const dir = await mkdtemp(new URL('../.test-build-', import.meta.url));
  let downloads = 0;
  try {
    const options = { publicDir: dir, download: async () => { downloads++; return Buffer.from('synthetic-test-widget'); } };
    await assert.rejects(build(options), /hydromancer-home.webp/);
    assert.equal(downloads, 0);
    await writeFile(`${dir}/hydromancer-home.webp`, 'not a webp');
    await assert.rejects(build(options), /WebP/);
    await writeFile(`${dir}/hydromancer-home.webp`, Buffer.from('RIFFxxxxWEBPsynthetic-test-image'));
    await build(options);
    assert.equal(await readFile(`${dir}/embed.js`, 'utf8'), 'synthetic-test-widget');
    assert.equal(downloads, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
