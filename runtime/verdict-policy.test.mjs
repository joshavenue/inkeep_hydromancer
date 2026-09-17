import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('fit policy leads with a scoped yes for a supported component, not partial-fit language', () => {
  const source = fs.readFileSync(new URL('./project.mjs', import.meta.url), 'utf8');
  assert.match(source, /SUPPORTED_COMPONENT_YES/);
  assert.match(source, /NFT minting/);
  assert.match(source, /capability from necessity/);
  assert.doesNotMatch(source, /Begin with a qualified yes\/no\/partial verdict/);
});
