import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const files = [
  'api/config.js', 'api/run/api/chat.js', 'api/run/auth/challenge.js',
  'api/run/auth/apps/[appId]/anonymous-session.js', 'api/run/v1/conversations.js',
  'api/run/v1/conversations/[conversationId].js', 'api/run/v1/events.js', 'api/run/v1/feedback.js',
];
const read = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return '';
  throw error;
});

test('explicit Vercel Node Web handlers cover each widget route without Next catchall assumptions', async () => {
  for (const file of files) {
    assert.notEqual(await read(file), '', `${file} exists`);
    const { default: handler } = await import(`../${file}`);
    assert.equal(typeof handler.fetch, 'function', file);
  }
  const config = JSON.parse(await read('vercel.json'));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'public');
  assert.equal(config.functions['api/**/*.js'].maxDuration, 300);
  assert.equal(config.functions['api/**/*.js'].supportsCancellation, true);
  assert.equal(config.rewrites, undefined);
  const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.match(headers['x-robots-tag'], /noindex/);
  assert.match(headers['content-security-policy'], /connect-src 'self'/);
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(headers['referrer-policy'], 'no-referrer');
});

test('public page uses the existing backdrop and initializes only the same-origin API', async () => {
  const html = await read('public/index.html');
  assert.match(html, /hydromancer-home.webp/);
  assert.match(html, /noindex/);
  assert.match(html, /type="module" src="\/init.js"/);
  const source = await read('public/init.js');
  assert.match(source, /^import '\.\/embed.js';/);
  const calls = [];
  let settings;
  const window = { location: { origin: 'https://inkeeptest.vercel.app' }, Inkeep: { ChatButton(config) { settings = config; } } };
  const context = vm.createContext({ window, fetch: async (...args) => { calls.push(args); return Response.json({ appId: 'app_synthetic' }); } });
  await new vm.Script(`(async () => { ${source.replace(/^import '\.\/embed.js';/, '')} })()`).runInContext(context);
  assert.equal(calls[0][0], '/api/config');
  assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(settings.aiChatSettings.baseUrl, 'https://inkeeptest.vercel.app/api');
  assert.equal(settings.aiChatSettings.appId, 'app_synthetic');
  assert.doesNotMatch(`${html}\n${source}`, /PREVIEW_INVITE_TOKEN|PREVIEW_UPSTREAM_ROOT|\/start\//);
});
