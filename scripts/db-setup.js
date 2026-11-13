// creates the database tables listed in db/schema.sql. safe to run again.
import fs from 'node:fs';
import { neon } from '@neondatabase/serverless';
import { loadEnv } from '../lib/env.js';

loadEnv();
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing. Run `vercel env pull` first.');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const text = fs.readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
// the database takes one statement per request, so comments are dropped and the file is split.
const statements = text.replace(/^\s*--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);
for (const statement of statements) await sql.query(statement);

const tables = await sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
console.log(`Ran ${statements.length} statements. Tables: ${tables.map((t) => t.table_name).join(', ')}`);
