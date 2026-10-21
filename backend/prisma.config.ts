import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// `prisma generate` (run by postinstall, pretest and build) never connects,
// so it gets a placeholder when DATABASE_URL is unset - `bun install` and
// image builds work without a database. Every other command still requires it.
const generateOnly = process.argv.includes('generate');
const url =
  generateOnly && !process.env.DATABASE_URL
    ? 'postgresql://placeholder@localhost:5432/placeholder'
    : env('DATABASE_URL');

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
});
