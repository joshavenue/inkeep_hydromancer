import { defineConfig } from 'drizzle-kit';
export default defineConfig({ schema: 'node_modules/@inkeep/agents-core/dist/db/manage/manage-schema.js', out: './.build/manage-migrations', dbCredentials: {url: process.env.INKEEP_AGENTS_MANAGE_DATABASE_URL}, dialect: 'postgresql' });
