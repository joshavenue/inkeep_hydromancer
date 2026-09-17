import { modelConfig } from './config.mjs';
// Fail before loading Inkeep, contacting services or opening a listener.
modelConfig();
// Released 0.80.6 logs an API-key prefix at info; do not enable verbose logs.
process.env.LOG_LEVEL = 'warn';
const { serve } = await import('@hono/node-server');
const { createAgentsApp } = await import('@inkeep/agents-api/factory');
const app = createAgentsApp({ serverConfig: { port: 18502 }, credentialStores: [] });
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 18502 });
console.log('Hydromancer Inkeep API: http://127.0.0.1:18502');
