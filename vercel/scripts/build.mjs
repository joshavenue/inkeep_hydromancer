import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Same unmodified artifact and digest documented in the repository THIRD_PARTY.md.
export const WIDGET_URL = 'https://cdn.jsdelivr.net/npm/@inkeep/agents-ui-js-cloud@0.17.8/dist/embed.js';
export const WIDGET_SHA256 = '8c75de39e4d2d82d4e0307bc82cf73bf252f5c9489a7794674811a9ac2307366';
const publicDirDefault = fileURLToPath(new URL('../public/', import.meta.url));

export async function downloadWidget({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(WIDGET_URL, { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('Pinned widget download failed.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 4_000_000) throw new Error('Pinned widget exceeds the size limit.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (createHash('sha256').update(bytes).digest('hex') !== WIDGET_SHA256) {
    throw new Error('Pinned widget integrity mismatch; no asset was written.');
  }
  return bytes;
}

export async function build({ publicDir = publicDirDefault, download = downloadWidget, widgetOnly = false } = {}) {
  if (!widgetOnly) {
    let image;
    try { image = await readFile(join(publicDir, 'hydromancer-home.webp')); }
    catch { throw new Error('Supply public/hydromancer-home.webp before building (copy the approved existing screenshot).'); }
    if (image.toString('ascii', 0, 4) !== 'RIFF' || image.toString('ascii', 8, 12) !== 'WEBP') {
      throw new Error('public/hydromancer-home.webp must be the approved WebP screenshot.');
    }
  }
  const widget = await download();
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'embed.js'), widget);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await build({ widgetOnly: process.argv.includes('--widget-only') });
    console.log('Pinned Inkeep widget 0.17.8 verified and written to public/embed.js.');
  } catch (error) {
    // This build never reads the four server environment variables.
    console.error(error.message);
    process.exitCode = 1;
  }
}
