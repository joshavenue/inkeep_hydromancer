import { defineConfig } from 'drizzle-kit';
export default defineConfig({ schema: 'node_modules/@inkeep/agents-core/dist/db/runtime/runtime-schema.js', out: 'node_modules/@inkeep/agents-core/drizzle/runtime', dbCredentials: {url: process.env.INKEEP_AGENTS_RUN_DATABASE_URL}, dialect: 'postgresql' });
