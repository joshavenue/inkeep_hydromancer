import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('server explicitly binds loopback and instantiates released Inkeep', () => { const s=fs.existsSync('server.mjs')?fs.readFileSync('server.mjs','utf8'):''; assert.match(s,/hostname: '127\.0\.0\.1'/); assert.match(s,/port: 18502/); assert.match(s,/@inkeep\/agents-api\/factory/); });
