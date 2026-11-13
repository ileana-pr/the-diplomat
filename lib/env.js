// reads .env.local and .env into process.env. a value that is already set wins.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadEnv() {
  // .env.local comes from `vercel env pull` and holds the database address.
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of fs.readFileSync(path.join(root, name), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    } catch {}
  }
}
